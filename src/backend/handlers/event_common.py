"""Shared flow of the event Lambdas (Contracts D1 to E2): parse -> validate -> store -> 202.

Each handler module only says which alert type it is, which validator applies and which
alert status it carries. The x-api-key is enforced by API Gateway before the Lambda runs.
"""
import base64
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

from .rules import derive_travel_status, normalize_timestamp
from .validation import ValidationError

ALERT_TTL_SECONDS = 7 * 24 * 3600

_ddb = None


def _tables():
    global _ddb
    if _ddb is None:
        import boto3

        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(os.environ["ALERTS_TABLE"]), _ddb.Table(os.environ["LATEST_TABLE"])


def to_dynamo(value):
    """float -> Decimal(str(x)), recursively (boto3 rejects float)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type,x-api-key",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def parse_body(event):
    raw = event.get("body")
    if raw is None:
        raise ValidationError("Missing request body")
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise ValidationError("Body is not valid JSON")


def _utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_alert(body, alert_type, alert_status, alert_reason, received_at):
    """The row stored in the alerts table: the event as sent plus cloud-derived fields."""
    ts = normalize_timestamp(body["timestamp"])
    item = {k: v for k, v in body.items() if k not in ("deviceId", "timestamp")}
    item.update({
        "deviceId": body["deviceId"],
        "sortKey": f"{ts}#{alert_type}",
        "alertType": alert_type,
        "timestamp": ts,
        "receivedAt": received_at,
        "heading": body.get("heading"),
        "travelStatus": derive_travel_status(body.get("heading")),
        "alertStatus": alert_status,
        "alertReason": alert_reason,
    })
    return item


def _is_condition_failed(ex):
    return getattr(ex, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def update_latest(latest_table, alert, extra=None):
    """Refresh the liveness fields of the device (and `extra`) on its latest item.

    Only touches fields it owns: `timestamp` and the snapshot fields stay with the processor.
    A replayed event older than what is stored only refreshes lastSeenAt / presenceState, so
    an old last call cannot overwrite a newer last known location.
    """
    fields = {"lastEventTimestamp": alert["timestamp"], **(extra or {})}
    names = {f"#f{i}": k for i, k in enumerate(fields)}
    values = {f":f{i}": v for i, v in enumerate(fields.values())}
    names.update({"#seen": "lastSeenAt", "#presence": "presenceState", "#last": "lastEventTimestamp"})
    values.update({":seen": alert["receivedAt"], ":online": "ONLINE", ":ts": alert["timestamp"]})
    sets = ", ".join(f"#f{i} = :f{i}" for i in range(len(fields)))
    key = {"deviceId": alert["deviceId"]}
    try:
        latest_table.update_item(
            Key=key,
            UpdateExpression=f"SET {sets}, #seen = :seen, #presence = :online",
            ConditionExpression="attribute_not_exists(#last) OR #last <= :ts",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=to_dynamo(values),
        )
    except Exception as ex:
        if not _is_condition_failed(ex):
            raise
        latest_table.update_item(
            Key=key,
            UpdateExpression="SET #seen = :seen, #presence = :online",
            ExpressionAttributeNames={"#seen": "lastSeenAt", "#presence": "presenceState"},
            ExpressionAttributeValues={":seen": alert["receivedAt"], ":online": "ONLINE"},
        )


def handle_event(event, *, alert_type, validator, alert_status, alert_reason, latest_extra=None):
    """Runs the whole flow for one event Lambda and returns the API Gateway response.

    latest_extra(alert) -> dict of extra fields for the latest item (e.g. lastKnownLocation).
    """
    try:
        body = parse_body(event)
        validator(body)
    except (ValidationError, UnicodeDecodeError) as ex:
        return response(400, {"error": "Validation failed", "details": str(ex)})

    alert = build_alert(body, alert_type, alert_status, alert_reason, _utc_now())
    alerts_table, latest_table = _tables()
    alerts_table.put_item(Item=to_dynamo({**alert, "expiresAt": int(datetime.now(timezone.utc).timestamp()) + ALERT_TTL_SECONDS}))
    update_latest(latest_table, alert, latest_extra(alert) if latest_extra else None)
    return response(202, {"accepted": 1, "deviceId": alert["deviceId"]})


def route_name(event):
    """Last path segment of the API Gateway request, e.g. 'battery-low'."""
    path = event.get("resource") or event.get("path") or ""
    return path.rstrip("/").rsplit("/", 1)[-1]


def dispatch(event, routes):
    """Run the handler config registered for the request's route; 404 for an unknown one.

    routes: {"battery-low": {alert_type, validator, alert_status, alert_reason, latest_extra?}, ...}
    """
    config = routes.get(route_name(event))
    if config is None:
        return response(404, {"error": "Not found"})
    return handle_event(event, **config)


def last_known_location(alert):
    """Position and heading of the call: lastKnownLocation, else the live location."""
    return alert.get("lastKnownLocation") or alert.get("location")
