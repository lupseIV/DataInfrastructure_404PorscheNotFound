"""Validation of the flat event bodies of Contracts D1 to E2. Pure Python, no AWS access.

Each validator takes the parsed JSON body and raises ValidationError. Thresholds come from
environment variables (read at call time, like QUEUE_URL elsewhere) with the contract defaults.
"""
import os

from .validation import (
    NETWORK_TYPES,
    ValidationError,
    is_int,
    is_number,
    validate_heading,
    validate_iso_timestamp,
    validate_location,
)

APP_STATES = ("foreground", "background")


def _env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def battery_low_threshold():
    return _env_float("BATTERY_LOW_THRESHOLD", 0.20)


def battery_last_call_threshold():
    return _env_float("BATTERY_LAST_CALL_THRESHOLD", 0.10)


def signal_drop_bars():
    return int(_env_float("SIGNAL_DROP_BARS", 2))


def signal_drop_window_seconds():
    return int(_env_float("SIGNAL_DROP_WINDOW_SECONDS", 60))


def signal_lost_dbm():
    return _env_float("SIGNAL_LOST_DBM", -110)


def _require_object(body):
    if not isinstance(body, dict):
        raise ValidationError("Body must be a single event object")


def _validate_common(body, require_last_known=False):
    """deviceId, timestamp, location / lastKnownLocation and heading (all event contracts)."""
    where = "event"
    device_id = body.get("deviceId")
    if not isinstance(device_id, str) or not device_id.strip():
        raise ValidationError(f"{where}: deviceId must be a non-empty string")
    validate_iso_timestamp(body.get("timestamp"), where)

    location, last_known = body.get("location"), body.get("lastKnownLocation")
    if location is None and last_known is None:
        raise ValidationError(f"{where}: location or lastKnownLocation is required")
    if location is not None:
        validate_location(location, where, require_captured_at=True)
    if last_known is not None:
        validate_location(last_known, f"{where} lastKnownLocation", require_captured_at=True)
    if require_last_known and last_known is None:
        raise ValidationError(f"{where}: lastKnownLocation is required")

    # Heading is optional: the phone has none without a GPS fix (sent as null or left out).
    if body.get("heading") is not None:
        validate_heading(body["heading"], where)


def _validate_ratio(body, field):
    value = body.get(field)
    if not is_number(value) or not 0.0 <= value <= 1.0:
        raise ValidationError(f"event: {field} must be a number between 0.0 and 1.0")
    return value


def _validate_bool(body, field):
    if not isinstance(body.get(field), bool):
        raise ValidationError(f"event: {field} must be a boolean")
    return body[field]


def _validate_choice(body, field, choices):
    if body.get(field) not in choices:
        raise ValidationError(f"event: {field} must be one of {', '.join(choices)}")


def _validate_pending(body):
    pending = body.get("pendingEventCount")
    if not is_int(pending) or pending < 0:
        raise ValidationError("event: pendingEventCount must be an integer >= 0")


def _validate_signal_level(body, field):
    level = body.get(field)
    if not is_int(level) or not 0 <= level <= 4:
        raise ValidationError(f"event: {field} must be an integer between 0 and 4")
    return level


def _validate_optional_dbm(body):
    if "signalDbm" in body and not is_number(body["signalDbm"]):
        raise ValidationError("event: signalDbm must be a number")


def _validate_battery_event(body, max_level, require_last_known):
    _require_object(body)
    _validate_common(body, require_last_known)
    level = _validate_ratio(body, "batteryLevel")
    if level > max_level:
        raise ValidationError(f"event: batteryLevel must be <= {max_level}")
    if _validate_bool(body, "isCharging"):
        raise ValidationError("event: isCharging must be false")
    _validate_bool(body, "powerSaveMode")
    _validate_choice(body, "appState", APP_STATES)


def validate_battery_low(body):
    """Contract D1."""
    _validate_battery_event(body, battery_low_threshold(), require_last_known=False)


def validate_battery_last_call(body):
    """Contract D2."""
    _validate_battery_event(body, battery_last_call_threshold(), require_last_known=True)
    _validate_pending(body)
    if "estimatedMinutesRemaining" in body and body["estimatedMinutesRemaining"] is not None:
        minutes = body["estimatedMinutesRemaining"]
        if not is_int(minutes) or minutes < 0:
            raise ValidationError("event: estimatedMinutesRemaining must be an integer >= 0 or null")


def _validate_connectivity_event(body, require_last_known):
    _require_object(body)
    _validate_common(body, require_last_known)
    _validate_signal_level(body, "signalLevel")
    _validate_signal_level(body, "previousSignalLevel")
    _validate_optional_dbm(body)
    _validate_choice(body, "networkType", NETWORK_TYPES)
    _validate_pending(body)
    _validate_ratio(body, "batteryLevel")


def validate_connectivity_degraded(body):
    """Contract E1: the level must have dropped by at least SIGNAL_DROP_BARS inside the window.

    Only the bar drop is checked: the payload carries no previous dBm value, so the
    dBm half of the contract's rule is evaluated on the phone.
    """
    _validate_connectivity_event(body, require_last_known=False)
    window = body.get("windowSeconds")
    if not is_int(window) or not 1 <= window <= signal_drop_window_seconds():
        raise ValidationError(f"event: windowSeconds must be an integer between 1 and {signal_drop_window_seconds()}")
    if body["previousSignalLevel"] - body["signalLevel"] < signal_drop_bars():
        raise ValidationError(f"event: signal must have dropped by at least {signal_drop_bars()} bars")


def validate_connectivity_last_call(body):
    """Contract E2: signalLevel == 0 or signalDbm <= SIGNAL_LOST_DBM."""
    _validate_connectivity_event(body, require_last_known=True)
    lost_by_dbm = "signalDbm" in body and body["signalDbm"] <= signal_lost_dbm()
    if body["signalLevel"] != 0 and not lost_by_dbm:
        raise ValidationError(f"event: signalLevel must be 0 or signalDbm <= {signal_lost_dbm():g}")
