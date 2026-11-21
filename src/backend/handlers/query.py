"""Dashboard API (Contract C)."""
import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

_ddb = None

FIELDS = (
    "batteryLevel", "isCharging", "activityState", "drainRatePerHour",
    "estimatedMinutesRemaining", "alertStatus", "alertReason",
    "location", "heading", "travelStatus",
)
DEFAULT_LIMIT, MAX_LIMIT = 50, 500


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
    return out


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
    raw = (params or {}).get("limit")
    try:
        limit = DEFAULT_LIMIT if raw is None else int(raw)
        if limit < 1:
            raise ValueError
    except ValueError:
        return _response(400, {"error": "limit must be a positive integer"})
    limit = min(limit, MAX_LIMIT)

    r = _table("SNAPSHOTS_TABLE").query(
        KeyConditionExpression=Key("deviceId").eq(device_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return _response(200, {"deviceId": device_id, "records": [to_record(i) for i in r.get("Items", [])]})


def handler(event, context):
    device_id = (event.get("pathParameters") or {}).get("deviceId")
    if device_id:
        return device_telemetry(device_id, event.get("queryStringParameters"))
    return list_devices()
