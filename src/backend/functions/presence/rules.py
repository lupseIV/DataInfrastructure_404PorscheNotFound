"""Contract F: server-side presence rules. Pure Python, no AWS access.

The presence Lambda calls next_presence for every latest item once a minute. "Silent" is
measured from lastSeenAt (server receipt time), never from the phone's clock.
"""
from .checks import parse_timestamp

SUSPECT_AFTER_SECONDS = 60
OFFLINE_GRACE_SECONDS = 240

REASON_BATTERY = "Silent after battery last call (likely battery dead)"
REASON_CONNECTIVITY = "Silent after connectivity last call (signal lost)"
REASON_UNKNOWN = "Silent, cause unknown"
REASON_RECOVERED = "Back online"


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def final_last_call(item):
    """The last call type if it was the final thing the phone sent, else None.

    A last call followed by newer data (lastEventTimestamp later than lastCallAt) is stale:
    the phone kept working after it, so it does not explain the silence.
    """
    call_type, call_at = item.get("lastCallType"), item.get("lastCallAt")
    if not call_type or not call_at:
        return None
    newest = item.get("lastEventTimestamp")
    return call_type if newest is None or call_at >= newest else None


def offline_alert(item, now, silent_seconds):
    """Fields of the presence_offline row: cause and position as last reported (no prediction)."""
    cause = final_last_call(item)
    reason = {"battery": REASON_BATTERY, "connectivity": REASON_CONNECTIVITY}.get(cause, REASON_UNKNOWN)
    if cause:
        location = item.get("lastKnownLocation") or item.get("location")
        heading = item.get("lastKnownHeading") or item.get("heading")
    else:
        location, heading = item.get("location"), item.get("heading")
    return {
        "alertType": "presence_offline",
        "timestamp": _iso(now),
        "receivedAt": _iso(now),
        "alertStatus": "CRITICAL",
        "alertReason": reason,
        "lastSeenAt": item["lastSeenAt"],
        "silentSeconds": silent_seconds,
        "lastCallType": cause,
        "location": location,
        "heading": heading,
    }


def recovered_alert(item, now):
    """Fields of the presence_recovered row, written once after an offline alert."""
    return {
        "alertType": "presence_recovered",
        "timestamp": _iso(now),
        "receivedAt": _iso(now),
        "alertStatus": "OK",
        "alertReason": REASON_RECOVERED,
        "lastSeenAt": item["lastSeenAt"],
        "offlineAlertSentAt": item["offlineAlertSentAt"],
        "location": item.get("location"),
        "heading": item.get("heading"),
    }


def next_presence(item, now, suspect_after=SUSPECT_AFTER_SECONDS, grace=OFFLINE_GRACE_SECONDS):
    """What the presence sweep should do with one latest item, or None for nothing.

    now: aware UTC datetime. Returns {"action": "recovered" | "offline" | "suspect",
    "state": new presenceState or None, "alert": alert fields or None}. Rules, in order:
      1. ONLINE again while an offline alert is open  -> recovered row, close the alert
      2. silent >= grace and not OFFLINE              -> OFFLINE + one presence_offline row
      3. silent >  suspect_after and ONLINE           -> SUSPECT (internal, notifies nobody)
    Going back to ONLINE is done by the processor and event Lambdas when data arrives.
    """
    seen = item.get("lastSeenAt")
    if not seen:
        return None  # never reported since liveness tracking started
    state = item.get("presenceState")
    silent = int((now - parse_timestamp(seen)).total_seconds())

    if state == "ONLINE" and item.get("offlineAlertSentAt"):
        return {"action": "recovered", "state": None, "alert": recovered_alert(item, now)}
    if silent >= grace and state != "OFFLINE":
        return {"action": "offline", "state": "OFFLINE", "alert": offline_alert(item, now, silent)}
    if silent > suspect_after and state == "ONLINE":
        return {"action": "suspect", "state": "SUSPECT", "alert": None}
    return None
