"""Contract A (telemetry batch) validation, used by ingest and processor. Pure Python, no AWS access."""
from .checks import (
    ISO_RE,
    NETWORK_TYPES,
    ValidationError,
    is_int,
    is_number,
    parse_timestamp,
    validate_heading,
    validate_location,
)

UNITS = {
    "battery_level": "ratio",
    "charging_state": "boolean",
    "acceleration": "m/s2",
    "location": "deg",
    "motion_heading": "deg",
    "signal_strength": "bars",
}


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
