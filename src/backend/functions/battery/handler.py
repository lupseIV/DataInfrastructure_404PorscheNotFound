"""Battery event Lambda: one function behind two routes (Contracts D1 and D2).

  POST /api/events/battery-low        status: battery at or below the low threshold
  POST /api/events/battery-last-call  last call before the phone runs out of battery
"""
from .events import dispatch, last_known_location

from .validation import validate_battery_last_call, validate_battery_low

ROUTES = {
    "battery-low": {
        "alert_type": "battery_low",
        "validator": validate_battery_low,
        "alert_status": "WARNING",
        "alert_reason": "Battery low",
    },
    "battery-last-call": {
        "alert_type": "battery_last_call",
        "validator": validate_battery_last_call,
        "alert_status": "CRITICAL",
        "alert_reason": "Battery last call",
        "latest_extra": lambda alert: {
            "lastKnownLocation": last_known_location(alert),
            "lastKnownHeading": alert.get("heading"),
            "lastCallType": "battery",
            "lastCallAt": alert["timestamp"],  # lets presence tell a final last call from a stale one
        },
    },
}


def handler(event, context):
    return dispatch(event, ROUTES)
