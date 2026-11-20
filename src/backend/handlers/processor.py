"""SQS FIFO -> DynamoDB (Contract B)."""
import json
import os
import time
from decimal import Decimal

import boto3

from .rules import build_snapshot, normalize_timestamp
from .validation import normalize_events, validate_events

HISTORY_TTL_SECONDS = 7 * 24 * 3600

_ddb = None


def _tables():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(os.environ["SNAPSHOTS_TABLE"]), _ddb.Table(os.environ["LATEST_TABLE"])


def to_dynamo(value):
    """float -> Decimal(str(x)), recursively (boto3 rejects float)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def process_events(raw_events):
    validate_events(raw_events)  # poison messages raise -> retry -> DLQ
    snapshots_table, latest_table = _tables()

    by_device = {}
    for e in raw_events:
        by_device.setdefault(e["deviceId"], {}).setdefault(normalize_timestamp(e["timestamp"]), []).append(e)

    for device_id, by_ts in by_device.items():
        prev = latest_table.get_item(Key={"deviceId": device_id}).get("Item")
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
            latest_table.put_item(Item=to_dynamo(snap))
            prev = snap


def handler(event, context):
    failures = []
    records = event.get("Records", [])
    for idx, record in enumerate(records):
        try:
            process_events(normalize_events(json.loads(record["body"])))
        except Exception as ex:
            print(f"Failed message {record.get('messageId')}: {ex!r}")
            # Report this and every later message so SQS retries them in order.
            failures = [{"itemIdentifier": r["messageId"]} for r in records[idx:]]
            break
    return {"batchItemFailures": failures}
