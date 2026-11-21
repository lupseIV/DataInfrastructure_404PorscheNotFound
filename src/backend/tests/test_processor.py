import json
import os
import re
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handlers import processor, rules  # noqa: E402

TS1 = "2026-11-21T10:00:00Z"
TS2 = "2026-11-21T10:00:05Z"
# 2026-11-21T10:00:07Z and 10:06:01Z in epoch milliseconds (SQS SentTimestamp format).
SENT_1007 = "1795255207000"
SENT_1601 = "1795255561000"


class FakeDynamoTable:
    """In-memory table supporting the update forms the processor uses.

    Like DynamoDB it rejects a SET on a key attribute, and it evaluates the
    `attribute_not_exists(#x) OR #x < :v` conditions used for liveness.
    """

    def __init__(self, key="deviceId"):
        self.key = key
        self.items = {}
        self.put = []

    def get_item(self, Key):
        item = self.items.get(Key[self.key])
        return {"Item": dict(item)} if item is not None else {}

    def put_item(self, Item):
        self.put.append(Item)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues,
                    ConditionExpression=None):
        names, values = ExpressionAttributeNames, ExpressionAttributeValues
        item = self.items.setdefault(Key[self.key], {self.key: Key[self.key]})
        if ConditionExpression:
            m = re.fullmatch(r"attribute_not_exists\((#\w+)\) OR (#\w+) < (:\w+)", ConditionExpression)
            assert m, f"unsupported condition {ConditionExpression}"
            attr = names[m.group(1)]
            if attr in item and not item[attr] < values[m.group(3)]:
                ex = Exception("conditional check failed")
                ex.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
                raise ex
        assert UpdateExpression.startswith("SET ")
        for part in UpdateExpression[4:].split(", "):
            name, value = part.split(" = ")
            attr = names[name]
            if attr == self.key:
                raise ValueError("Cannot update key attribute")
            item[attr] = values[value]


def ev(event_type, value, unit, ts=TS1):
    return {"deviceId": "d1", "eventType": event_type, "value": value, "unit": unit, "timestamp": ts}


def batch(ts=TS1, signal=None):
    events = [ev("battery_level", 0.8, "ratio", ts), ev("charging_state", False, "boolean", ts)]
    if signal is not None:
        events.append(ev("signal_strength", signal, "bars", ts))
    return events


class SignalSnapshotTests(unittest.TestCase):
    def test_signal_is_stored(self):
        snap = rules.build_snapshot("d1", TS1, batch(signal={"level": 3, "dbm": -87, "networkType": "cellular"}), None)
        self.assertEqual(snap["signal"], {"level": 3, "dbm": -87, "networkType": "cellular"})

    def test_signal_without_dbm(self):
        snap = rules.build_snapshot("d1", TS1, batch(signal={"level": 2, "networkType": "wifi"}), None)
        self.assertEqual(snap["signal"], {"level": 2, "networkType": "wifi"})

    def test_no_signal_reading_is_null_then_carried_forward(self):
        self.assertIsNone(rules.build_snapshot("d1", TS1, batch(), None)["signal"])
        first = rules.build_snapshot("d1", TS1, batch(signal={"level": 3, "networkType": "cellular"}), None)
        second = rules.build_snapshot("d1", TS2, batch(TS2), first)
        self.assertEqual(second["signal"], {"level": 3, "networkType": "cellular"})


class ReceivedAtTests(unittest.TestCase):
    def test_from_sqs_sent_timestamp(self):
        self.assertEqual(processor.received_at_of({"attributes": {"SentTimestamp": SENT_1007}}), "2026-11-21T10:00:07Z")

    def test_missing_attribute_falls_back_to_now(self):
        self.assertRegex(processor.received_at_of({}), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class ProcessorLivenessTests(unittest.TestCase):
    def setUp(self):
        self.snapshots, self.latest = FakeDynamoTable(), FakeDynamoTable()
        patcher = mock.patch.object(processor, "_tables", return_value=(self.snapshots, self.latest))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_batch(self, events, sent):
        record = {"messageId": "m1", "body": json.dumps(events), "attributes": {"SentTimestamp": sent}}
        return processor.handler({"Records": [record]}, None)

    def item(self):
        return self.latest.items["d1"]

    def test_batch_sets_liveness_and_stores_signal(self):
        res = self.run_batch(batch(signal={"level": 3, "dbm": -87, "networkType": "cellular"}), SENT_1007)
        self.assertEqual(res, {"batchItemFailures": []})
        item = self.item()
        self.assertEqual(item["lastSeenAt"], "2026-11-21T10:00:07Z")
        self.assertEqual(item["presenceState"], "ONLINE")
        self.assertEqual(item["lastEventTimestamp"], TS1)
        self.assertEqual(item["signal"]["dbm"], -87)
        self.assertEqual(self.snapshots.put[0]["signal"]["level"], 3)  # history row too

    def test_offline_device_comes_back_online(self):
        self.run_batch(batch(TS1), SENT_1007)
        self.item()["presenceState"] = "OFFLINE"  # as the presence Lambda would set it
        self.run_batch(batch(TS2), SENT_1601)
        self.assertEqual(self.item()["presenceState"], "ONLINE")
        self.assertEqual(self.item()["lastSeenAt"], "2026-11-21T10:06:01Z")

    def test_last_seen_never_moves_backwards(self):
        # An event Lambda already recorded a later contact; this batch was queued earlier.
        self.latest.items["d1"] = {"deviceId": "d1", "lastSeenAt": "2026-11-21T10:06:01Z"}
        self.run_batch(batch(TS1), SENT_1007)
        self.assertEqual(self.item()["lastSeenAt"], "2026-11-21T10:06:01Z")

    def test_older_replayed_data_keeps_newest_event_timestamp(self):
        self.run_batch(batch(TS2), SENT_1007)
        self.run_batch(batch(TS1), SENT_1601)  # older data delivered later
        self.assertEqual(self.item()["lastEventTimestamp"], TS2)
        # ...but it is still contact from the device.
        self.assertEqual(self.item()["lastSeenAt"], "2026-11-21T10:06:01Z")

    def test_replayed_batch_writes_no_duplicate_snapshot(self):
        self.run_batch(batch(TS1), SENT_1007)
        self.run_batch(batch(TS1), SENT_1007)  # SQS retry of the same message
        self.assertEqual(len(self.snapshots.put), 1)

    def test_key_is_never_in_an_update(self):
        # FakeDynamoTable raises like DynamoDB does; a failure would show up as a batch item failure.
        res = self.run_batch(batch(signal={"level": 1, "networkType": "wifi"}), SENT_1007)
        self.assertEqual(res, {"batchItemFailures": []})

    def test_other_dynamo_errors_still_fail_the_message(self):
        with mock.patch.object(self.latest, "update_item", side_effect=RuntimeError("throttled")):
            res = self.run_batch(batch(), SENT_1007)
        self.assertEqual(res, {"batchItemFailures": [{"itemIdentifier": "m1"}]})


if __name__ == "__main__":
    unittest.main()
