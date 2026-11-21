"""Checks shared by the event body validators (battery and connectivity, Contracts D1 to E2).

Pure Python, no AWS access. Each check raises ValidationError. Thresholds come from environment
variables (read at call time, like QUEUE_URL elsewhere) with the contract defaults.
"""
import os

from .checks import (
    ValidationError,
    is_int,
    is_number,
    validate_heading,
    validate_iso_timestamp,
    validate_location,
)


def env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def require_object(body):
    if not isinstance(body, dict):
        raise ValidationError("Body must be a single event object")


def validate_common(body, require_last_known=False):
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


def validate_ratio(body, field):
    value = body.get(field)
    if not is_number(value) or not 0.0 <= value <= 1.0:
        raise ValidationError(f"event: {field} must be a number between 0.0 and 1.0")
    return value


def validate_choice(body, field, choices):
    if body.get(field) not in choices:
        raise ValidationError(f"event: {field} must be one of {', '.join(choices)}")


def validate_pending(body):
    pending = body.get("pendingEventCount")
    if not is_int(pending) or pending < 0:
        raise ValidationError("event: pendingEventCount must be an integer >= 0")
