import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from boto3.dynamodb.types import TypeDeserializer  # noqa: E402

from handlers import presence, rules  # noqa: E402

T0 = datetime(2026, 11, 21, 10, 0, 0, tzinfo=timezone.utc)  # last contact
SEEN = "2026-11-21T10:00:00Z"
LOC = {"lat": 46.77, "lon": 23.59, "accuracyM": 8, "capturedAt": "2026-11-21T09:59:58Z"}
CALL_LOC = {"lat": 46.70, "lon": 23.50, "accuracyM": 12, "capturedAt": "2026-11-21T09:59:55Z"}


def at(seconds):
    return T0 + timedelta(seconds=seconds)


def device(**extra):
    item = {"deviceId": "d1", "lastSeenAt": SEEN, "presenceState": "ONLINE",
            "lastEventTimestamp": "2026-11-21T09:59:58Z", "location": LOC,
            "heading": {"degrees": 274, "speedMps": 1.3}}
    item.update(extra)
    return item


class ConditionFailed(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


def _holds(condition, item, names, values):
    """Evaluates the condition forms presence.py uses: `#a = :b`, attribute_not_exists(#a), AND."""
    for part in condition.split(" AND "):
        if part.startswith("attribute_not_exists("):
            if names[part[len("attribute_not_exists("):-1]] in item:
                return False
        else:
            name, value = part.split(" = ")
            if item.get(names[name]) != values[value]:
                return False
    return True


def _apply(expression, item, names, values):
    action, rest = expression.split(" ", 1)
    for part in rest.split(", "):
        if action == "SET":
            name, value = part.split(" = ")
            item[names[name]] = values[value]
        else:  # REMOVE
            item.pop(names[part], None)


class FakeDynamo:
    """In-memory latest + alerts tables with conditional updates and all-or-nothing transactions."""

    def __init__(self, *items):
        self.latest = {i["deviceId"]: dict(i) for i in items}
        self.alerts = []
        self.fail_with = None  # error code to raise on the next write, e.g. "ProvisionedThroughputExceeded"

    # Table-like API (scan / update_item) for the latest table.
    def scan(self, **kwargs):
        return {"Items": [dict(i) for i in self.latest.values()]}

    def update_item(self, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames,
                    ExpressionAttributeValues):
        item = self.latest[Key["deviceId"]]
        if not _holds(ConditionExpression, item, ExpressionAttributeNames, ExpressionAttributeValues):
            raise ConditionFailed("ConditionalCheckFailedException")
        _apply(UpdateExpression, item, ExpressionAttributeNames, ExpressionAttributeValues)

    # Client-like API (low-level attribute values) for the transaction.
    def transact_write_items(self, TransactItems):
        if self.fail_with:
            raise ConditionFailed(self.fail_with)
        de = TypeDeserializer()
        upd = TransactItems[0]["Update"]
        put = TransactItems[1]["Put"]
        key = {k: de.deserialize(v) for k, v in upd["Key"].items()}
        values = {k: de.deserialize(v) for k, v in upd["ExpressionAttributeValues"].items()}
        item = self.latest[key["deviceId"]]
        if not _holds(upd["ConditionExpression"], item, upd["ExpressionAttributeNames"], values):
            raise ConditionFailed("TransactionCanceledException")  # nothing is written
        _apply(upd["UpdateExpression"], item, upd["ExpressionAttributeNames"], values)
        self.alerts.append({k: de.deserialize(v) for k, v in put["Item"].items()})


def run(db, now):
    return presence.sweep(db, db, "latest", "alerts", now, 60, 240)


class NextPresenceRuleTests(unittest.TestCase):
    def action(self, item, seconds):
        decision = rules.next_presence(item, at(seconds))
        return decision and decision["action"]

    def test_suspect_boundary(self):
        self.assertIsNone(self.action(device(), 60))
        self.assertEqual(self.action(device(), 61), "suspect")

    def test_offline_boundary(self):
        self.assertEqual(self.action(device(presenceState="SUSPECT"), 239), None)
        self.assertEqual(self.action(device(presenceState="SUSPECT"), 240), "offline")
        # A device the sweep never saw as SUSPECT goes straight to OFFLINE too.
        self.assertEqual(self.action(device(), 240), "offline")

    def test_offline_device_gets_no_new_alert(self):
        self.assertIsNone(self.action(device(presenceState="OFFLINE", offlineAlertSentAt="x"), 3600))

    def test_recovered_when_online_with_open_alert(self):
        self.assertEqual(self.action(device(offlineAlertSentAt="2026-11-21T09:00:00Z"), 5), "recovered")

    def test_item_without_last_seen_is_skipped(self):
        self.assertIsNone(rules.next_presence({"deviceId": "d1"}, at(9999)))

    def test_cause_battery_uses_last_call_position(self):
        item = device(lastCallType="battery", lastCallAt="2026-11-21T09:59:58Z",
                      lastKnownLocation=CALL_LOC, lastKnownHeading={"degrees": 90, "speedMps": 0})
        alert = rules.next_presence(item, at(270))["alert"]
        self.assertEqual(alert["alertReason"], rules.REASON_BATTERY)
        self.assertEqual(alert["lastCallType"], "battery")
        self.assertEqual(alert["location"], CALL_LOC)
        self.assertEqual(alert["heading"]["degrees"], 90)
        self.assertEqual(alert["silentSeconds"], 270)
        self.assertEqual(alert["alertStatus"], "CRITICAL")

    def test_cause_connectivity(self):
        item = device(lastCallType="connectivity", lastCallAt="2026-11-21T09:59:58Z", lastKnownLocation=CALL_LOC)
        self.assertEqual(rules.next_presence(item, at(270))["alert"]["alertReason"], rules.REASON_CONNECTIVITY)

    def test_stale_last_call_is_cause_unknown_with_newest_position(self):
        # Battery last call at 09:00, but the phone kept sending until 09:59:58.
        item = device(lastCallType="battery", lastCallAt="2026-11-21T09:00:00Z", lastKnownLocation=CALL_LOC)
        alert = rules.next_presence(item, at(270))["alert"]
        self.assertEqual(alert["alertReason"], rules.REASON_UNKNOWN)
        self.assertIsNone(alert["lastCallType"])
        self.assertEqual(alert["location"], LOC)

    def test_no_last_call_is_cause_unknown(self):
        self.assertEqual(rules.next_presence(device(), at(270))["alert"]["alertReason"], rules.REASON_UNKNOWN)

    def test_offline_alert_has_no_battery_level(self):
        # Alert rows store battery as a ratio; the latest item has percent, so it is left out.
        self.assertNotIn("batteryLevel", rules.next_presence(device(batteryLevel=9.0), at(270))["alert"])


class SweepTests(unittest.TestCase):
    def test_full_timeline(self):
        db = FakeDynamo(device())
        run(db, at(30))
        self.assertEqual(db.latest["d1"]["presenceState"], "ONLINE")
        run(db, at(90))
        self.assertEqual(db.latest["d1"]["presenceState"], "SUSPECT")
        self.assertEqual(db.alerts, [])  # SUSPECT notifies nobody
        run(db, at(270))
        self.assertEqual(db.latest["d1"]["presenceState"], "OFFLINE")
        self.assertEqual(db.latest["d1"]["offlineAlertSentAt"], "2026-11-21T10:04:30Z")
        for minute in range(6, 20):
            run(db, at(minute * 60 + 30))
        self.assertEqual([a["alertType"] for a in db.alerts], ["presence_offline"])  # once, not every minute

        # The phone comes back: the processor sets ONLINE and a fresh lastSeenAt.
        db.latest["d1"].update(presenceState="ONLINE", lastSeenAt="2026-11-21T10:20:05Z")
        run(db, at(20 * 60 + 30))
        run(db, at(21 * 60))  # 55 s after it came back: still ONLINE, no second recovered row
        self.assertEqual([a["alertType"] for a in db.alerts], ["presence_offline", "presence_recovered"])
        self.assertNotIn("offlineAlertSentAt", db.latest["d1"])
        self.assertEqual(db.latest["d1"]["presenceState"], "ONLINE")

    def test_short_gap_never_alerts(self):
        db = FakeDynamo(device())
        run(db, at(90))  # SUSPECT after 90 s of silence
        db.latest["d1"].update(presenceState="ONLINE", lastSeenAt="2026-11-21T10:01:35Z")  # back after 95 s
        for minute in range(2, 6):
            run(db, at(minute * 60))
        self.assertEqual(db.alerts, [])

    def test_alert_row_shape(self):
        db = FakeDynamo(device())
        run(db, at(270))
        row = db.alerts[0]
        self.assertEqual(row["sortKey"], "2026-11-21T10:04:30Z#presence_offline")
        self.assertEqual(row["deviceId"], "d1")
        self.assertEqual(row["expiresAt"], int(at(270).timestamp()) + 7 * 24 * 3600)
        self.assertEqual(row["lastSeenAt"], SEEN)

    def test_phone_reports_during_sweep_is_not_marked(self):
        db = FakeDynamo(device(presenceState="SUSPECT"))
        original_scan = db.scan

        def scan_then_data_arrives(**kwargs):
            result = original_scan(**kwargs)
            db.latest["d1"].update(presenceState="ONLINE", lastSeenAt="2026-11-21T10:04:29Z")
            return result

        db.scan = scan_then_data_arrives
        counts = run(db, at(270))
        self.assertEqual(counts["skipped"], 1)
        self.assertEqual(db.latest["d1"]["presenceState"], "ONLINE")
        self.assertEqual(db.alerts, [])  # transaction cancelled: no state change, no row

    def test_two_sweeps_at_once_write_one_alert(self):
        db = FakeDynamo(device(presenceState="SUSPECT"))
        stale = db.scan()["Items"]
        run(db, at(270))
        with mock.patch.object(db, "scan", return_value={"Items": stale}):
            counts = run(db, at(271))  # second sweep acting on the old read
        self.assertEqual(counts["skipped"], 1)
        self.assertEqual(len(db.alerts), 1)

    def test_other_errors_are_counted_and_fail_the_handler(self):
        db = FakeDynamo(device(presenceState="SUSPECT"))
        db.fail_with = "ProvisionedThroughputExceededException"
        self.assertEqual(run(db, at(270))["errors"], 1)
        self.assertEqual(db.latest["d1"]["presenceState"], "SUSPECT")  # nothing half-written

        fake_resource = mock.Mock()
        fake_resource.Table.return_value = db
        fake_resource.meta.client = db
        with mock.patch.object(presence, "_resource", return_value=fake_resource), \
                mock.patch.dict(os.environ, {"LATEST_TABLE": "latest", "ALERTS_TABLE": "alerts"}):
            with self.assertRaises(RuntimeError):
                presence.handler({}, None)

    def test_thresholds_from_env(self):
        db = FakeDynamo(device())
        fake_resource = mock.Mock()
        fake_resource.Table.return_value = db
        fake_resource.meta.client = db
        env = {"LATEST_TABLE": "latest", "ALERTS_TABLE": "alerts", "OFFLINE_GRACE_SECONDS": "100000"}
        with mock.patch.object(presence, "_resource", return_value=fake_resource), \
                mock.patch.dict(os.environ, env), \
                mock.patch.object(presence, "datetime", wraps=datetime) as fake_dt:
            fake_dt.now.return_value = at(600)
            counts = presence.handler({}, None)
        self.assertEqual(counts["suspect"], 1)  # 10 min silent, but the grace is set very high
        self.assertEqual(db.alerts, [])


if __name__ == "__main__":
    unittest.main()
