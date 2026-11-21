"""Validation of the battery event bodies (Contracts D1, D2). Pure Python, no AWS access."""
from .event_body import (
    env_float,
    require_object,
    validate_choice,
    validate_common,
    validate_pending,
    validate_ratio,
)
from .checks import ValidationError, is_int

APP_STATES = ("foreground", "background")


def battery_low_threshold():
    return env_float("BATTERY_LOW_THRESHOLD", 0.20)


def battery_last_call_threshold():
    return env_float("BATTERY_LAST_CALL_THRESHOLD", 0.10)


def _validate_bool(body, field):
    if not isinstance(body.get(field), bool):
        raise ValidationError(f"event: {field} must be a boolean")
    return body[field]


def _validate_battery_event(body, max_level, require_last_known):
    require_object(body)
    validate_common(body, require_last_known)
    level = validate_ratio(body, "batteryLevel")
    if level > max_level:
        raise ValidationError(f"event: batteryLevel must be <= {max_level}")
    if _validate_bool(body, "isCharging"):
        raise ValidationError("event: isCharging must be false")
    _validate_bool(body, "powerSaveMode")
    validate_choice(body, "appState", APP_STATES)


def validate_battery_low(body):
    """Contract D1."""
    _validate_battery_event(body, battery_low_threshold(), require_last_known=False)


def validate_battery_last_call(body):
    """Contract D2."""
    _validate_battery_event(body, battery_last_call_threshold(), require_last_known=True)
    validate_pending(body)
    if "estimatedMinutesRemaining" in body and body["estimatedMinutesRemaining"] is not None:
        minutes = body["estimatedMinutesRemaining"]
        if not is_int(minutes) or minutes < 0:
            raise ValidationError("event: estimatedMinutesRemaining must be an integer >= 0 or null")
