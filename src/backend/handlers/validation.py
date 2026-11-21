"""Contract A validation. Pure Python, no AWS access."""
import math
import re
from datetime import datetime

UNITS = {
    "battery_level": "ratio",
    "charging_state": "boolean",
    "acceleration": "m/s2",
    "location": "deg",
    "motion_heading": "deg",
    "signal_strength": "bars",
}
NETWORK_TYPES = ("wifi", "cellular", "none")
# ISO-8601 UTC ending in Z; fractional seconds tolerated (normalised by the processor).
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


class ValidationError(Exception):
    pass


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_timestamp(ts):
    """Parse an ISO UTC string ending in Z into an aware datetime."""
    return datetime.fromisoformat(ts[:-1] + "+00:00")


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def validate_iso_timestamp(ts, where, field="timestamp"):
    if not isinstance(ts, str) or not ISO_RE.match(ts):
        raise ValidationError(f"{where}: {field} must be ISO-8601 UTC ending in Z")
    try:
        parse_timestamp(ts)
    except ValueError:
        raise ValidationError(f"{where}: {field} is not a valid date")


def validate_location(value, where, require_captured_at=False):
    """{lat, lon, accuracyM, altitudeM?} (+ capturedAt when used inside an event body)."""
    if not isinstance(value, dict):
        raise ValidationError(f"{where}: location must be an object")
    lat, lon, acc = value.get("lat"), value.get("lon"), value.get("accuracyM")
    if not is_number(lat) or not -90.0 <= lat <= 90.0:
        raise ValidationError(f"{where}: location.lat must be a number between -90 and 90")
    if not is_number(lon) or not -180.0 <= lon <= 180.0:
        raise ValidationError(f"{where}: location.lon must be a number between -180 and 180")
    if not is_number(acc) or acc < 0:
        raise ValidationError(f"{where}: location.accuracyM must be a number >= 0")
    if "altitudeM" in value and not is_number(value["altitudeM"]):
        raise ValidationError(f"{where}: location.altitudeM must be a number")
    if require_captured_at or "capturedAt" in value:
        validate_iso_timestamp(value.get("capturedAt"), where, "location.capturedAt")


def validate_heading(value, where):
    """{degrees, speedMps}: raw GPS course and speed."""
    if not isinstance(value, dict):
        raise ValidationError(f"{where}: heading must be an object")
    degrees, speed = value.get("degrees"), value.get("speedMps")
    if not is_number(degrees) or not 0.0 <= degrees <= 360.0:
        raise ValidationError(f"{where}: heading.degrees must be a number between 0 and 360")
    if not is_number(speed) or speed < 0:
        raise ValidationError(f"{where}: heading.speedMps must be a number >= 0")


def validate_signal_strength(value, where):
    """{level 0..4, dbm?, networkType}."""
    if not isinstance(value, dict):
        raise ValidationError(f"{where}: signal_strength must be an object")
    if not is_int(value.get("level")) or not 0 <= value["level"] <= 4:
        raise ValidationError(f"{where}: signal_strength.level must be an integer between 0 and 4")
    if "dbm" in value and not is_number(value["dbm"]):
        raise ValidationError(f"{where}: signal_strength.dbm must be a number")
    if value.get("networkType") not in NETWORK_TYPES:
        raise ValidationError(f"{where}: signal_strength.networkType must be one of {', '.join(NETWORK_TYPES)}")


def normalize_events(payload):
    """Single object or array -> list of events."""
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        return payload
    raise ValidationError("Body must be an event object or an array of events")


def validate_event(e, i=0):
    where = f"event {i}"
    if not isinstance(e, dict):
        raise ValidationError(f"{where}: must be an object")
    for field in ("deviceId", "eventType", "value", "unit", "timestamp"):
        if field not in e:
            raise ValidationError(f"{where}: missing field '{field}'")

    device_id, et, value, unit, ts = (e[k] for k in ("deviceId", "eventType", "value", "unit", "timestamp"))
    if not isinstance(device_id, str) or not device_id.strip():
        raise ValidationError(f"{where}: deviceId must be a non-empty string")
    if et not in UNITS:
        raise ValidationError(f"{where}: unknown eventType '{et}'")
    if unit != UNITS[et]:
        raise ValidationError(f"{where}: unit for {et} must be '{UNITS[et]}'")
    if not isinstance(ts, str) or not ISO_RE.match(ts):
        raise ValidationError(f"{where}: timestamp must be ISO-8601 UTC ending in Z")
    try:
        parse_timestamp(ts)
    except ValueError:
        raise ValidationError(f"{where}: timestamp is not a valid date")

    if et == "battery_level":
        if not is_number(value) or not 0.0 <= value <= 1.0:
            raise ValidationError(f"{where}: battery_level must be a number between 0.0 and 1.0")
    elif et == "charging_state":
        if not isinstance(value, bool):
            raise ValidationError(f"{where}: charging_state must be a boolean")
    elif et == "acceleration":
        if not isinstance(value, dict) or not all(is_number(value.get(a)) for a in "xyz"):
            raise ValidationError(f"{where}: acceleration must be an object with finite numbers x, y, z")
    elif et == "location":
        validate_location(value, where)
    elif et == "motion_heading":
        validate_heading(value, where)
    elif et == "signal_strength":
        validate_signal_strength(value, where)


def validate_events(events):
    if not events:
        raise ValidationError("Body must contain at least one event")
    for i, e in enumerate(events):
        validate_event(e, i)
