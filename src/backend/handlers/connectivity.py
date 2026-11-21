"""Connectivity event Lambda: one function behind two routes (Contracts E1 and E2).

  POST /api/events/connectivity-degraded   informational: the signal is dropping fast
  POST /api/events/connectivity-last-call  last call before the connection is lost

Neither alerts the team by itself: the presence logic raises the alert only if the device
stays silent past the grace period (Contract F).
"""
from .event_common import dispatch, last_known_location
from .event_validation import validate_connectivity_degraded, validate_connectivity_last_call

ROUTES = {
    "connectivity-degraded": {
        "alert_type": "connectivity_degraded",
        "validator": validate_connectivity_degraded,
        "alert_status": "OK",
        "alert_reason": None,
        "latest_extra": lambda alert: {"signalLevel": alert["signalLevel"]},
    },
    "connectivity-last-call": {
        "alert_type": "connectivity_last_call",
        "validator": validate_connectivity_last_call,
        "alert_status": "OK",
        "alert_reason": None,
        "latest_extra": lambda alert: {
            "signalLevel": alert["signalLevel"],
            "lastKnownLocation": last_known_location(alert),
            "lastKnownHeading": alert.get("heading"),
            "lastCallType": "connectivity",
            "lastCallAt": alert["timestamp"],  # lets presence tell a final last call from a stale one
        },
    },
}


def handler(event, context):
    return dispatch(event, ROUTES)
