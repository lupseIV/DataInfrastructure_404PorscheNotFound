"""SQS FIFO -> DynamoDB (Contract B), plus the liveness fields of Contract F."""
import json
import os
import time
from datetime import datetime, timezone

import boto3

from .contract_a import normalize_events, validate_events
from .dynamo import is_condition_failed, to_dynamo
from .travel import normalize_timestamp

from .snapshot import build_snapshot

HISTORY_TTL_SECONDS = 7 * 24 * 3600

_ddb = None


def _tables():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(os.environ["SNAPSHOTS_TABLE"]), _ddb.Table(os.environ["LATEST_TABLE"])


def put_latest(latest_table, snap):
    """Write the snapshot fields without replacing the item.

    The event Lambdas keep their own fields on the same item (lastSeenAt, lastKnownLocation,
    lastCallType, ...); a full put_item would erase them.
    The key (deviceId) goes in Key only: DynamoDB rejects an update expression that sets it.
    """
    fields = {k: v for k, v in snap.items() if k != "deviceId"}
    names = {f"#f{i}": k for i, k in enumerate(fields)}
    values = {f":f{i}": v for i, v in enumerate(fields.values())}
    latest_table.update_item(
        Key={"deviceId": snap["deviceId"]},
        UpdateExpression="SET " + ", ".join(f"#f{i} = :f{i}" for i in range(len(fields))),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=to_dynamo(values),
    )


def _iso_from_millis(millis):
    return datetime.fromtimestamp(int(millis) / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def received_at_of(record):
    """When the server received the batch: the SQS SentTimestamp (set when ingest queued it).

    Falls back to now when the attribute is missing (e.g. a hand-made test event).
    """
    sent = (record.get("attributes") or {}).get("SentTimestamp")
    try:
        return _iso_from_millis(sent)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def update_liveness(latest_table, device_id, received_at, newest_event_ts):
    """Contract F liveness on the latest item; both fields only ever move forward.

    - lastSeenAt (server receipt time) + presenceState ONLINE: skipped when an event Lambda
      already recorded a later contact, so a delayed batch never makes a device look older.
    - lastEventTimestamp (device time of the newest data): skipped for older replayed data.
    Fixed-width ISO UTC strings compare chronologically.
    """
    updates = (
        ("SET #seen = :seen, #presence = :online",
         {"#seen": "lastSeenAt", "#presence": "presenceState"},
         {":seen": received_at, ":online": "ONLINE"},
         "attribute_not_exists(#seen) OR #seen < :seen"),
        ("SET #last = :ts",
         {"#last": "lastEventTimestamp"},
         {":ts": newest_event_ts},
         "attribute_not_exists(#last) OR #last < :ts"),
    )
    for expression, names, values, condition in updates:
        try:
            latest_table.update_item(
                Key={"deviceId": device_id},
                UpdateExpression=expression,
                ConditionExpression=condition,
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
        except Exception as ex:
            if not is_condition_failed(ex):
                raise


def process_events(raw_events, received_at=None):
    """received_at: ISO UTC receipt time of the batch (see received_at_of)."""
    validate_events(raw_events)  # poison messages raise -> retry -> DLQ
    snapshots_table, latest_table = _tables()
    if received_at is None:
        received_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    by_device = {}
    for e in raw_events:
        by_device.setdefault(e["deviceId"], {}).setdefault(normalize_timestamp(e["timestamp"]), []).append(e)

    for device_id, by_ts in by_device.items():
        prev = latest_table.get_item(Key={"deviceId": device_id}).get("Item")
        if prev is not None and "batteryLevel" not in prev:
            prev = None  # item created by an event Lambda: no snapshot has been processed yet
        # Any batch is contact from the device, even one whose data is older than what is stored.
        update_liveness(latest_table, device_id, received_at, max(by_ts))
        for ts in sorted(by_ts):  # oldest first; fixed-width UTC strings sort chronologically
            if prev and ts <= prev["timestamp"]:
                # Already processed (SQS retry) or older than the latest state: nothing to do.
                print(f"Skipping {device_id} {ts}: not newer than {prev['timestamp']}")
                continue
            snap = build_snapshot(device_id, ts, by_ts[ts], prev)
            history = {k: v for k, v in snap.items() if k != "lastAccel"}
            history["expiresAt"] = int(time.time()) + HISTORY_TTL_SECONDS
            # History first: if the latest write fails, the retry redoes both (same keys, safe).
            snapshots_table.put_item(Item=to_dynamo(history))
            put_latest(latest_table, snap)
            prev = snap


def handler(event, context):
    failures = []
    records = event.get("Records", [])
    for idx, record in enumerate(records):
        try:
            process_events(normalize_events(json.loads(record["body"])), received_at_of(record))
        except Exception as ex:
            print(f"Failed message {record.get('messageId')}: {ex!r}")
            # Report this and every later message so SQS retries them in order.
            failures = [{"itemIdentifier": r["messageId"]} for r in records[idx:]]
            break
    return {"batchItemFailures": failures}
