"""Track 2 business rules (steps 1-3). Pure Python, no AWS access."""
import math

from .validation import parse_timestamp

GRAVITY = 9.81
DEFAULT_ACCEL = {"x": 0.0, "y": 0.0, "z": GRAVITY}
MIN_DRAIN_INTERVAL_HOURS = 5 / 3600


def normalize_timestamp(ts):
    """Exact YYYY-MM-DDTHH:MM:SSZ (second precision) so string order == time order."""
    return parse_timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def classify_activity(accel):
    mag = math.sqrt(accel["x"] ** 2 + accel["y"] ** 2 + accel["z"] ** 2)
    dyn = abs(mag - GRAVITY)
    if dyn < 0.8:
        return "stationary"
    if dyn < 2.8:
        return "walking"
    return "in_vehicle"


# GPS speed thresholds (m/s) for travelStatus: ~1.8 km/h and ~18 km/h.
WALKING_SPEED_MPS = 0.5
VEHICLE_SPEED_MPS = 5.0


def derive_travel_status(heading):
    """stationary | walking | in_vehicle from the raw GPS speed; unknown until a heading arrives."""
    if not heading:
        return "unknown"
    speed = float(heading["speedMps"])
    if speed >= VEHICLE_SPEED_MPS:
        return "in_vehicle"
    if speed >= WALKING_SPEED_MPS:
        return "walking"
    return "stationary"


def evaluate_alert(is_charging, battery, activity, drain):
    if not is_charging:
        if battery < 20:
            return "CRITICAL", "Critical battery level below 20%"
        if drain > 25.0:
            return "CRITICAL", "Severe battery drain spike detected"
        if activity == "stationary" and drain > 12.0:
            return "WARNING", "Abnormal idle battery drain (thermal/background load risk)"
        if activity == "in_vehicle" and battery < 40:
            return "WARNING", "Device unplugged in vehicle transit below 40%"
    return "OK", None


def default_snapshot():
    return {
        "batteryLevel": 100.0,
        "isCharging": False,
        "activityState": "stationary",
        "drainRatePerHour": 0.0,
        "lastAccel": dict(DEFAULT_ACCEL),
    }


def build_snapshot(device_id, timestamp, events, prev):
    """events: raw events sharing one timestamp. prev: previous snapshot dict or None.

    Returns a Contract B snapshot plus an internal 'lastAccel' (kept only in the latest table).
    """
    by_type = {e["eventType"]: e["value"] for e in events}
    base = prev if prev else default_snapshot()

    if "battery_level" in by_type:
        battery = round(by_type["battery_level"] * 100, 2)
    else:
        battery = float(base["batteryLevel"])
    charging = bool(by_type["charging_state"]) if "charging_state" in by_type else bool(base["isCharging"])
    if "acceleration" in by_type:
        accel = {a: float(by_type["acceleration"][a]) for a in "xyz"}
    else:
        accel = {a: float(v) for a, v in (base.get("lastAccel") or DEFAULT_ACCEL).items()}
    activity = classify_activity(accel)

    prev_battery = float(prev["batteryLevel"]) if prev else None
    prev_drain = float(prev["drainRatePerHour"]) if prev else 0.0
    if charging or prev is None or battery >= prev_battery:
        drain = 0.0
    else:
        dt_hours = (parse_timestamp(timestamp) - parse_timestamp(prev["timestamp"])).total_seconds() / 3600
        if dt_hours < MIN_DRAIN_INTERVAL_HOURS:
            drain = prev_drain
        else:
            drain = round((prev_battery - battery) / dt_hours, 2)

    remaining = None if charging or drain <= 0 else round(battery / drain * 60)
    status, reason = evaluate_alert(charging, battery, activity, drain)

    # Location and heading are kept as last reported; a batch without them keeps the previous ones.
    location = base.get("location")
    if "location" in by_type:
        raw = by_type["location"]
        location = {"lat": raw["lat"], "lon": raw["lon"], "accuracyM": raw["accuracyM"], "capturedAt": timestamp}
        if "altitudeM" in raw:
            location["altitudeM"] = raw["altitudeM"]
    heading = base.get("heading")
    if "motion_heading" in by_type:
        raw = by_type["motion_heading"]
        heading = {"degrees": raw["degrees"], "speedMps": raw["speedMps"]}

    return {
        "id": f"{device_id}_{timestamp}",
        "deviceId": device_id,
        "timestamp": timestamp,
        "batteryLevel": battery,
        "isCharging": charging,
        "activityState": activity,
        "drainRatePerHour": drain,
        "estimatedMinutesRemaining": remaining,
        "alertStatus": status,
        "alertReason": reason,
        "location": location,
        "heading": heading,
        "travelStatus": derive_travel_status(heading),
        "lastAccel": accel,
    }
