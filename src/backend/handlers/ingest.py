"""POST /api/telemetry (Contract A). Validates only; all calculations happen in processor.py.

The x-api-key is enforced by API Gateway before this Lambda runs.
"""
import base64
import json
import os

from .validation import ValidationError, normalize_events, validate_events

_sqs = None
MAX_EVENTS_PER_MESSAGE = 200  # keeps each SQS message far below the 256 KB limit


def _client():
    global _sqs
    if _sqs is None:
        import boto3

        _sqs = boto3.client("sqs")
    return _sqs


def _response(status, body):
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


def _parse_body(event):
    raw = event.get("body")
    if raw is None:
        raise ValidationError("Missing request body")
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise ValidationError("Body is not valid JSON")


def handler(event, context):
    try:
        events = normalize_events(_parse_body(event))
        validate_events(events)
    except (ValidationError, UnicodeDecodeError) as ex:
        return _response(400, {"error": "Validation failed", "details": str(ex)})

    by_device = {}
    for e in events:
        by_device.setdefault(e["deviceId"], []).append(e)

    queue_url = os.environ["QUEUE_URL"]
    for device_id, device_events in by_device.items():
        for i in range(0, len(device_events), MAX_EVENTS_PER_MESSAGE):
            chunk = device_events[i:i + MAX_EVENTS_PER_MESSAGE]
            # No MessageDeduplicationId: the queue de-duplicates identical bodies (phone retries).
            _client().send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps(chunk, separators=(",", ":")),
                MessageGroupId=device_id,
            )

    return _response(202, {"accepted": len(events), "deviceId": next(iter(by_device))})
