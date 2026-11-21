"""Scheduled presence sweep (Contract F). Runs every minute from EventBridge.

For every device in the latest table it asks rules.next_presence what to do:
  - SUSPECT:   silent > 60 s; internal state, nobody is notified
  - OFFLINE:   silent >= 240 s; one presence_offline alert row, then nothing until it returns
  - recovered: the device sent data again after an offline alert; one presence_recovered row

Safety:
  - Every write is conditional on the lastSeenAt / state just read, so a phone that reports
    while the sweep runs is never marked SUSPECT or OFFLINE.
  - The state change and its alert row are written in one DynamoDB transaction: both or
    neither, so an alert can never be lost while the state says it was sent.
Thresholds: SUSPECT_AFTER_SECONDS (default 60) and OFFLINE_GRACE_SECONDS (default 240).
"""
import os
from datetime import datetime, timezone

from .event_common import ALERT_TTL_SECONDS, to_dynamo
from .rules import OFFLINE_GRACE_SECONDS, SUSPECT_AFTER_SECONDS, next_presence

_ddb = None


def _resource():
    global _ddb
    if _ddb is None:
        import boto3

        _ddb = boto3.resource("dynamodb")
    return _ddb


def _setting(name, default):
    try:
        return int(float(os.environ.get(name, default)))
    except ValueError:
        return default


def _error_code(ex):
    return getattr(ex, "response", {}).get("Error", {}).get("Code")


def scan_devices(latest_table):
    items, kwargs = [], {}
    while True:
        r = latest_table.scan(**kwargs)
        items.extend(r.get("Items", []))
        if "LastEvaluatedKey" not in r:
            return items
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def mark_suspect(latest_table, item):
    """ONLINE -> SUSPECT, only if nothing arrived since the scan."""
    latest_table.update_item(
        Key={"deviceId": item["deviceId"]},
        UpdateExpression="SET #presence = :suspect",
        ConditionExpression="#seen = :seen AND #presence = :state",
        ExpressionAttributeNames={"#presence": "presenceState", "#seen": "lastSeenAt"},
        ExpressionAttributeValues={":suspect": "SUSPECT", ":seen": item["lastSeenAt"], ":state": item["presenceState"]},
    )


def _alert_row(item, alert, now_epoch):
    row = {"deviceId": item["deviceId"], "sortKey": f"{alert['timestamp']}#{alert['alertType']}", **alert}
    row["expiresAt"] = now_epoch + ALERT_TTL_SECONDS
    return to_dynamo(row)


def latest_update_for(item, decision, now_iso):
    """The conditional update of the latest item that goes with an offline / recovered row."""
    key = {"deviceId": item["deviceId"]}
    if decision["action"] == "offline":
        return {
            "Key": key,
            "UpdateExpression": "SET #presence = :offline, #sent = :now",
            # Unchanged since the scan, and no alert already open (no duplicate alerts).
            "ConditionExpression": "#seen = :seen AND #presence = :state AND attribute_not_exists(#sent)",
            "ExpressionAttributeNames": {"#presence": "presenceState", "#sent": "offlineAlertSentAt", "#seen": "lastSeenAt"},
            "ExpressionAttributeValues": {":offline": "OFFLINE", ":now": now_iso,
                                          ":seen": item["lastSeenAt"], ":state": item["presenceState"]},
        }
    return {  # recovered: close the alert that was read, only while the device is ONLINE
        "Key": key,
        "UpdateExpression": "REMOVE #sent",
        "ConditionExpression": "#sent = :sent AND #presence = :online",
        "ExpressionAttributeNames": {"#sent": "offlineAlertSentAt", "#presence": "presenceState"},
        "ExpressionAttributeValues": {":sent": item["offlineAlertSentAt"], ":online": "ONLINE"},
    }


def write_with_alert(client, latest_name, alerts_name, item, decision, now_iso, now_epoch):
    """State change + alert row in one transaction (both or neither)."""
    from boto3.dynamodb.types import TypeSerializer

    ser = TypeSerializer()
    update = latest_update_for(item, decision, now_iso)
    client.transact_write_items(TransactItems=[
        {"Update": {
            "TableName": latest_name,
            "Key": {k: ser.serialize(v) for k, v in update["Key"].items()},
            "UpdateExpression": update["UpdateExpression"],
            "ConditionExpression": update["ConditionExpression"],
            "ExpressionAttributeNames": update["ExpressionAttributeNames"],
            "ExpressionAttributeValues": {k: ser.serialize(v) for k, v in update["ExpressionAttributeValues"].items()},
        }},
        {"Put": {
            "TableName": alerts_name,
            "Item": {k: ser.serialize(v) for k, v in _alert_row(item, decision["alert"], now_epoch).items()},
        }},
    ])


def sweep(latest_table, client, latest_name, alerts_name, now, suspect_after, grace):
    """One pass over all devices. Returns counts per action (for the log)."""
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    now_epoch = int(now.timestamp())
    counts = {"suspect": 0, "offline": 0, "recovered": 0, "skipped": 0, "errors": 0}
    for item in scan_devices(latest_table):
        decision = next_presence(item, now, suspect_after, grace)
        if decision is None:
            continue
        try:
            if decision["action"] == "suspect":
                mark_suspect(latest_table, item)
            else:
                write_with_alert(client, latest_name, alerts_name, item, decision, now_iso, now_epoch)
            counts[decision["action"]] += 1
        except Exception as ex:
            # Data arrived (or another sweep acted) after the scan: leave it for the next run.
            if _error_code(ex) in ("ConditionalCheckFailedException", "TransactionCanceledException"):
                counts["skipped"] += 1
            else:
                counts["errors"] += 1
                print(f"presence: {item.get('deviceId')} {decision['action']} failed: {ex!r}")
    return counts


def handler(event, context):
    ddb = _resource()
    latest_name, alerts_name = os.environ["LATEST_TABLE"], os.environ["ALERTS_TABLE"]
    counts = sweep(
        ddb.Table(latest_name),
        ddb.meta.client,
        latest_name,
        alerts_name,
        datetime.now(timezone.utc),
        _setting("SUSPECT_AFTER_SECONDS", SUSPECT_AFTER_SECONDS),
        _setting("OFFLINE_GRACE_SECONDS", OFFLINE_GRACE_SECONDS),
    )
    print(f"presence: {counts}")
    if counts["errors"]:
        # Fail the invocation so the error shows up in metrics; the conditions make a retry safe.
        raise RuntimeError(f"presence sweep had {counts['errors']} error(s)")
    return counts
