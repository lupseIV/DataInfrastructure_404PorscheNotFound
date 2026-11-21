"""Basic checks used by every validator (Contract A and the event contracts). Pure Python, no AWS access."""
import math
import re
from datetime import datetime

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
