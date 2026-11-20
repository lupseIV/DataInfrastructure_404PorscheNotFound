"""Contract A validation. Pure Python, no AWS access."""
import math
import re
from datetime import datetime

UNITS = {"battery_level": "ratio", "charging_state": "boolean", "acceleration": "m/s2"}
# ISO-8601 UTC ending in Z; fractional seconds tolerated (normalised by the processor).
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


class ValidationError(Exception):
    pass


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_timestamp(ts):
    """Parse an ISO UTC string ending in Z into an aware datetime."""
    return datetime.fromisoformat(ts[:-1] + "+00:00")


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


def validate_events(events):
    if not events:
        raise ValidationError("Body must contain at least one event")
    for i, e in enumerate(events):
        validate_event(e, i)
