"""Validation of the connectivity event bodies (Contracts E1, E2). Pure Python, no AWS access."""
from .event_body import (
    env_float,
    require_object,
    validate_choice,
    validate_common,
    validate_pending,
    validate_ratio,
)
from .checks import NETWORK_TYPES, ValidationError, is_int, is_number


def signal_drop_bars():
    return int(env_float("SIGNAL_DROP_BARS", 2))


def signal_drop_dbm():
    return env_float("SIGNAL_DROP_DBM", 15)


def signal_drop_window_seconds():
    return int(env_float("SIGNAL_DROP_WINDOW_SECONDS", 60))


def signal_lost_dbm():
    return env_float("SIGNAL_LOST_DBM", -110)


def _validate_signal_level(body, field):
    level = body.get(field)
    if not is_int(level) or not 0 <= level <= 4:
        raise ValidationError(f"event: {field} must be an integer between 0 and 4")
    return level


def _validate_optional_dbm(body):
    if "signalDbm" in body and not is_number(body["signalDbm"]):
        raise ValidationError("event: signalDbm must be a number")


def _validate_connectivity_event(body, require_last_known):
    require_object(body)
    validate_common(body, require_last_known)
    _validate_signal_level(body, "signalLevel")
    _validate_signal_level(body, "previousSignalLevel")
    _validate_optional_dbm(body)
    validate_choice(body, "networkType", NETWORK_TYPES)
    validate_pending(body)
    validate_ratio(body, "batteryLevel")


def validate_connectivity_degraded(body):
    """Contract E1: the signal dropped fast inside the window.

    Valid when the level dropped by at least SIGNAL_DROP_BARS, or when the phone also sent
    previousSignalDbm (the best dBm of the window) and the dBm dropped by at least
    SIGNAL_DROP_DBM. Without previousSignalDbm only the bar rule can be checked.
    """
    _validate_connectivity_event(body, require_last_known=False)
    window = body.get("windowSeconds")
    if not is_int(window) or not 1 <= window <= signal_drop_window_seconds():
        raise ValidationError(f"event: windowSeconds must be an integer between 1 and {signal_drop_window_seconds()}")
    if "previousSignalDbm" in body and not is_number(body["previousSignalDbm"]):
        raise ValidationError("event: previousSignalDbm must be a number")

    bars_drop = body["previousSignalLevel"] - body["signalLevel"]
    dbm_drop = None
    if "previousSignalDbm" in body and "signalDbm" in body:
        dbm_drop = body["previousSignalDbm"] - body["signalDbm"]
    if bars_drop < signal_drop_bars() and (dbm_drop is None or dbm_drop < signal_drop_dbm()):
        raise ValidationError(
            f"event: signal must have dropped by at least {signal_drop_bars()} bars "
            f"or {signal_drop_dbm():g} dBm (dBm needs previousSignalDbm and signalDbm)"
        )


def validate_connectivity_last_call(body):
    """Contract E2: signalLevel == 0 or signalDbm <= SIGNAL_LOST_DBM."""
    _validate_connectivity_event(body, require_last_known=True)
    lost_by_dbm = "signalDbm" in body and body["signalDbm"] <= signal_lost_dbm()
    if body["signalLevel"] != 0 and not lost_by_dbm:
        raise ValidationError(f"event: signalLevel must be 0 or signalDbm <= {signal_lost_dbm():g}")
