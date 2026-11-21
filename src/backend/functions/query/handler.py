"""Dashboard API (Contract C).

  GET /api/devices                        latest state of every device
  GET /api/devices/{deviceId}/telemetry   snapshot history, newest first
  GET /api/devices/{deviceId}/alerts      stored last-call / status / presence events, newest first
"""
import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

_ddb = None

# Fields of a snapshot, returned by the device list and the history.
FIELDS = (
    "batteryLevel", "isCharging", "activityState", "drainRatePerHour",
    "estimatedMinutesRemaining", "alertStatus", "alertReason",
    "location", "heading", "travelStatus", "signal",
)
# Extra fields only the latest item has: last-call fields (battery / connectivity Lambdas)
# and Contract F liveness (presenceState: processor, event Lambdas and presence.py;
# lastSeenAt: server receipt time). The dashboard trusts presenceState over its own
# staleness check, so this relies on the presence Lambda running to ever set OFFLINE.
DEVICE_FIELDS = (
    "lastCallType", "lastCallAt", "lastKnownLocation", "lastKnownHeading",
    "presenceState", "lastSeenAt",
)
# Storage-only attributes of an alert row, never returned.
ALERT_INTERNAL_FIELDS = ("deviceId", "sortKey", "expiresAt", "schemaVersion")
DEFAULT_LIMIT, MAX_LIMIT = 50, 500

ROUTE_DEVICES = "/api/devices"
ROUTE_TELEMETRY = "/api/devices/{deviceId}/telemetry"
ROUTE_ALERTS = "/api/devices/{deviceId}/alerts"


def _table(env):
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(os.environ[env])


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Not serializable: {type(o)}")


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type,x-api-key",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(body, default=_json_default),
    }


def _pick(item):
    return {f: item.get(f) for f in FIELDS}


def to_device(item):
    out = {"deviceId": item["deviceId"], "lastUpdated": item["timestamp"]}
    out.update(_pick(item))
    out.update({f: item.get(f) for f in DEVICE_FIELDS})
    return out


def to_alert(item):
    """An alert row as returned: storage fields removed, batteryLevel as percent.

    The event Lambdas store the phone's raw ratio (0.64); the device list and history
    use percent (64.0), so the dashboard gets one unit everywhere.
    """
    out = {k: v for k, v in item.items() if k not in ALERT_INTERNAL_FIELDS}
    if out.get("batteryLevel") is not None:
        out["batteryLevel"] = round(float(out["batteryLevel"]) * 100, 2)
    return out


def _parse_limit(params):
    """Validated ?limit=N (default 50, capped at 500), or None when invalid."""
    raw = (params or {}).get("limit")
    try:
        limit = DEFAULT_LIMIT if raw is None else int(raw)
    except ValueError:
        return None
    return min(limit, MAX_LIMIT) if limit >= 1 else None


def _newest_first(env, device_id, limit):
    """One Query on a table keyed by deviceId + sort key, read backwards (newest first)."""
    r = _table(env).query(
        KeyConditionExpression=Key("deviceId").eq(device_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return r.get("Items", [])


def to_record(item):
    out = {"timestamp": item["timestamp"]}
    out.update(_pick(item))
    return out


def list_devices():
    table, items, kwargs = _table("LATEST_TABLE"), [], {}
    while True:
        r = table.scan(**kwargs)
        items.extend(r.get("Items", []))
        if "LastEvaluatedKey" not in r:
            break
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    # Items created by an event Lambda before the first snapshot have no 'timestamp' yet.
    items = [i for i in items if "timestamp" in i]
    items.sort(key=lambda i: i["deviceId"])
    return _response(200, [to_device(i) for i in items])


def device_telemetry(device_id, params):
    limit = _parse_limit(params)
    if limit is None:
        return _response(400, {"error": "limit must be a positive integer"})
    items = _newest_first("SNAPSHOTS_TABLE", device_id, limit)
    return _response(200, {"deviceId": device_id, "records": [to_record(i) for i in items]})


def device_alerts(device_id, params):
    """Contract C #3. The sort key is '<timestamp>#<alertType>', so newest first = by time."""
    limit = _parse_limit(params)
    if limit is None:
        return _response(400, {"error": "limit must be a positive integer"})
    items = _newest_first("ALERTS_TABLE", device_id, limit)
    return _response(200, {"deviceId": device_id, "records": [to_alert(i) for i in items]})


def _route(event):
    """Route template of the request, e.g. '/api/devices/{deviceId}/alerts'.

    API Gateway sends it as `resource`. Without it (hand-made events), it is rebuilt from
    the path parameters so the three routes still resolve.
    """
    resource = event.get("resource")
    if resource:
        return resource.rstrip("/")
    if not (event.get("pathParameters") or {}).get("deviceId"):
        return ROUTE_DEVICES
    return ROUTE_ALERTS if (event.get("path") or "").rstrip("/").endswith("/alerts") else ROUTE_TELEMETRY


def handler(event, context):
    route = _route(event)
    device_id = (event.get("pathParameters") or {}).get("deviceId")
    params = event.get("queryStringParameters")
    if route == ROUTE_DEVICES:
        return list_devices()
    if route == ROUTE_TELEMETRY and device_id:
        return device_telemetry(device_id, params)
    if route == ROUTE_ALERTS and device_id:
        return device_alerts(device_id, params)
    return _response(404, {"error": "Not found"})
