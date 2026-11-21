import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handlers import (  # noqa: E402
    battery as battery_lambda,
    connectivity as connectivity_lambda,
    event_common,
    event_validation,
    processor,
    validation,
)

TS = "2026-11-20T18:41:10Z"
LOC = {"lat": 48.1391, "lon": 11.5702, "accuracyM": 8.0, "capturedAt": "2026-11-20T18:41:08Z"}
HEADING = {"degrees": 274.0, "speedMps": 12.3}


def battery(level=0.09, **extra):
    body = {
        "deviceId": "d1", "timestamp": TS, "batteryLevel": level, "isCharging": False,
        "powerSaveMode": True, "appState": "background", "location": LOC, "heading": HEADING,
        "lastKnownLocation": LOC, "pendingEventCount": 4,
    }
    body.update(extra)
    return body


def connectivity(level=0, previous=3, **extra):
    body = {
        "deviceId": "d1", "timestamp": TS, "signalLevel": level, "previousSignalLevel": previous,
        "networkType": "cellular", "pendingEventCount": 2, "batteryLevel": 0.4,
        "location": LOC, "heading": HEADING, "lastKnownLocation": LOC, "windowSeconds": 45,
    }
    body.update(extra)
    return body


class ValidatorTests(unittest.TestCase):
    def rejects(self, fn, body):
        with self.assertRaises(validation.ValidationError):
            fn(body)

    def test_battery_thresholds(self):
        event_validation.validate_battery_low(battery(0.20))
        self.rejects(event_validation.validate_battery_low, battery(0.21))
        event_validation.validate_battery_last_call(battery(0.10))
        self.rejects(event_validation.validate_battery_last_call, battery(0.11))

    def test_battery_event_must_not_be_charging(self):
        self.rejects(event_validation.validate_battery_low, battery(isCharging=True))

    def test_battery_last_call_requires_last_known_location(self):
        body = battery()
        del body["lastKnownLocation"]
        self.rejects(event_validation.validate_battery_last_call, body)
        event_validation.validate_battery_low(body)  # D1 only needs location or lastKnownLocation

    def test_location_or_last_known_required(self):
        body = battery()
        body["location"] = None
        event_validation.validate_battery_low(body)  # lastKnownLocation is enough
        del body["lastKnownLocation"]
        self.rejects(event_validation.validate_battery_low, body)

    def test_heading_is_optional_but_validated_when_present(self):
        body = battery()
        body["heading"] = None
        event_validation.validate_battery_low(body)
        del body["heading"]
        event_validation.validate_battery_last_call(body)
        self.rejects(event_validation.validate_battery_low, battery(heading={"degrees": 400, "speedMps": 1}))
        self.rejects(event_validation.validate_battery_low, battery(heading="north"))

    def test_bad_coordinates_and_timestamp(self):
        self.rejects(event_validation.validate_battery_low, battery(location=dict(LOC, lat=95)))
        self.rejects(event_validation.validate_battery_low, battery(timestamp="2026-11-20 18:41"))

    def test_degraded_needs_two_bar_drop(self):
        event_validation.validate_connectivity_degraded(connectivity(level=1, previous=3))
        self.rejects(event_validation.validate_connectivity_degraded, connectivity(level=2, previous=3))
        self.rejects(event_validation.validate_connectivity_degraded, connectivity(level=1, previous=3, windowSeconds=61))

    def test_degraded_accepts_dbm_drop_with_previous_dbm(self):
        # 3 -> 2 bars is only 1 bar, but -85 -> -102 is a 17 dBm drop.
        event_validation.validate_connectivity_degraded(
            connectivity(level=2, previous=3, signalDbm=-102, previousSignalDbm=-85))
        # Exactly at the threshold counts.
        event_validation.validate_connectivity_degraded(
            connectivity(level=2, previous=3, signalDbm=-100, previousSignalDbm=-85))

    def test_degraded_rejects_drop_under_both_thresholds(self):
        self.rejects(event_validation.validate_connectivity_degraded,
                     connectivity(level=2, previous=3, signalDbm=-95, previousSignalDbm=-85))

    def test_degraded_dbm_drop_needs_previous_dbm(self):
        # Without previousSignalDbm the server cannot see a dBm drop: only the bar rule applies.
        self.rejects(event_validation.validate_connectivity_degraded,
                     connectivity(level=2, previous=3, signalDbm=-102))
        # previousSignalDbm without signalDbm cannot prove a drop either.
        self.rejects(event_validation.validate_connectivity_degraded,
                     connectivity(level=2, previous=3, previousSignalDbm=-85))

    def test_degraded_previous_dbm_must_be_a_number(self):
        self.rejects(event_validation.validate_connectivity_degraded,
                     connectivity(level=1, previous=3, signalDbm=-102, previousSignalDbm="-85"))

    def test_degraded_dbm_threshold_from_env(self):
        body = connectivity(level=2, previous=3, signalDbm=-102, previousSignalDbm=-85)
        with mock.patch.dict(os.environ, {"SIGNAL_DROP_DBM": "20"}):
            self.rejects(event_validation.validate_connectivity_degraded, body)

    def test_last_call_needs_lost_signal(self):
        event_validation.validate_connectivity_last_call(connectivity(level=0, previous=1))
        event_validation.validate_connectivity_last_call(connectivity(level=1, previous=2, signalDbm=-115))
        self.rejects(event_validation.validate_connectivity_last_call, connectivity(level=1, previous=2, signalDbm=-100))
        self.rejects(event_validation.validate_connectivity_last_call, connectivity(level=2, previous=3))


class FakeTable:
    def __init__(self):
        self.put = []
        self.updates = []
        self.fail_condition = False

    def put_item(self, Item):
        self.put.append(Item)

    def update_item(self, **kwargs):
        # Like DynamoDB: an update expression may not touch a key attribute.
        touched = set(kwargs.get("ExpressionAttributeNames", {}).values())
        if touched & set(kwargs["Key"]):
            raise ValueError(f"Cannot update key attribute(s) {touched & set(kwargs['Key'])}")
        if self.fail_condition and "ConditionExpression" in kwargs:
            ex = Exception("conditional check failed")
            ex.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
            raise ex
        self.updates.append(kwargs)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.alerts, self.latest = FakeTable(), FakeTable()
        patcher = mock.patch.object(event_common, "_tables", return_value=(self.alerts, self.latest))
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, route, body, raw=None):
        """route: the API Gateway path segment; it picks the Lambda and the event inside it."""
        lambda_module = battery_lambda if route.startswith("battery") else connectivity_lambda
        event = {"resource": f"/api/events/{route}", "body": raw if raw is not None else json.dumps(body)}
        return lambda_module.handler(event, None)

    def test_battery_last_call_stores_alert_and_latest(self):
        res = self.call("battery-last-call", battery())
        self.assertEqual(res["statusCode"], 202)
        self.assertEqual(json.loads(res["body"]), {"accepted": 1, "deviceId": "d1"})
        alert = self.alerts.put[0]
        self.assertEqual(alert["sortKey"], f"{TS}#battery_last_call")
        self.assertEqual(alert["alertStatus"], "CRITICAL")
        self.assertEqual(alert["travelStatus"], "in_vehicle")
        self.assertIn("expiresAt", alert)
        update = self.latest.updates[0]
        self.assertEqual(update["Key"], {"deviceId": "d1"})
        self.assertIn("lastCallType", update["ExpressionAttributeNames"].values())
        self.assertIn("battery", update["ExpressionAttributeValues"].values())
        self.assertNotIn("timestamp", update["ExpressionAttributeNames"].values())  # owned by the processor

    def test_battery_low_is_warning_and_sets_no_last_call(self):
        self.call("battery-low", battery(0.19))
        self.assertEqual(self.alerts.put[0]["alertStatus"], "WARNING")
        self.assertNotIn("lastCallType", self.latest.updates[0]["ExpressionAttributeNames"].values())

    def test_connectivity_events_do_not_alert_the_team(self):
        self.call("connectivity-degraded", connectivity(level=1, previous=3))
        self.call("connectivity-last-call", connectivity(level=0, previous=1))
        self.assertEqual([a["alertStatus"] for a in self.alerts.put], ["OK", "OK"])
        self.assertEqual(self.alerts.put[1]["alertType"], "connectivity_last_call")

    def test_one_lambda_routes_by_path_to_the_right_event(self):
        self.call("battery-low", battery(0.19))
        self.call("battery-last-call", battery(0.09))
        self.assertEqual([a["alertType"] for a in self.alerts.put], ["battery_low", "battery_last_call"])

    def test_each_route_validates_with_its_own_rules(self):
        # 0.15 is fine for battery-low but above the last-call threshold.
        self.assertEqual(self.call("battery-low", battery(0.15))["statusCode"], 202)
        self.assertEqual(self.call("battery-last-call", battery(0.15))["statusCode"], 400)

    def test_unknown_route_is_404(self):
        res = battery_lambda.handler({"resource": "/api/events/battery-nope", "body": "{}"}, None)
        self.assertEqual(res["statusCode"], 404)
        self.assertEqual((self.alerts.put, self.latest.updates), ([], []))

    def test_route_falls_back_to_path_when_resource_missing(self):
        res = battery_lambda.handler({"path": "/api/events/battery-low/", "body": json.dumps(battery(0.19))}, None)
        self.assertEqual(res["statusCode"], 202)

    def test_last_call_without_heading_is_stored_with_unknown_travel_status(self):
        res = self.call("battery-last-call", battery(heading=None))
        self.assertEqual(res["statusCode"], 202)
        self.assertEqual(self.alerts.put[0]["travelStatus"], "unknown")
        self.assertIsNone(self.alerts.put[0]["heading"])

    def test_validation_failure_is_400_and_writes_nothing(self):
        res = self.call("battery-last-call", battery(0.5))
        self.assertEqual(res["statusCode"], 400)
        self.assertEqual(json.loads(res["body"])["error"], "Validation failed")
        self.assertEqual((self.alerts.put, self.latest.updates), ([], []))

    def test_invalid_json_and_missing_body_are_400(self):
        self.assertEqual(self.call("battery-low", None, raw="{nope")["statusCode"], 400)
        self.assertEqual(battery_lambda.handler({"resource": "/api/events/battery-low"}, None)["statusCode"], 400)

    def test_replayed_old_event_only_refreshes_liveness(self):
        self.latest.fail_condition = True
        res = self.call("battery-last-call", battery())
        self.assertEqual(res["statusCode"], 202)
        update = self.latest.updates[0]
        self.assertNotIn("lastKnownLocation", update["ExpressionAttributeNames"].values())
        self.assertIn("lastSeenAt", update["ExpressionAttributeNames"].values())

    def latest_fields(self, n=0):
        update = self.latest.updates[n]
        names, values = update["ExpressionAttributeNames"], update["ExpressionAttributeValues"]
        sets = update["UpdateExpression"].split("SET ", 1)[1].split(", ")
        return {names[n_]: values[v] for n_, v in (s.split(" = ") for s in sets)}

    def test_both_last_calls_record_when_they_happened(self):
        self.call("battery-last-call", battery(timestamp="2026-11-20T18:41:10.500Z"))
        self.call("connectivity-last-call", connectivity(level=0, previous=1))
        battery_fields, conn_fields = self.latest_fields(0), self.latest_fields(1)
        self.assertEqual(battery_fields["lastCallType"], "battery")
        self.assertEqual(battery_fields["lastCallAt"], TS)  # normalized like every timestamp
        self.assertEqual(conn_fields["lastCallType"], "connectivity")
        self.assertEqual(conn_fields["lastCallAt"], TS)
        # Same value as lastEventTimestamp, so presence sees it as the final thing sent.
        self.assertEqual(battery_fields["lastCallAt"], battery_fields["lastEventTimestamp"])

    def test_status_events_do_not_set_last_call(self):
        self.call("battery-low", battery(0.19))
        self.call("connectivity-degraded", connectivity(level=1, previous=3))
        for n in (0, 1):
            self.assertNotIn("lastCallAt", self.latest_fields(n))
            self.assertNotIn("lastCallType", self.latest_fields(n))

    def test_replayed_old_last_call_does_not_overwrite_newer_one(self):
        # Stored lastEventTimestamp is newer, so the conditional update fails and only
        # liveness is refreshed: lastCallAt / lastCallType stay as they are.
        self.latest.fail_condition = True
        self.call("battery-last-call", battery())
        fields = self.latest_fields(0)
        self.assertNotIn("lastCallAt", fields)
        self.assertNotIn("lastCallType", fields)
        self.assertEqual(fields["presenceState"], "ONLINE")

    def test_same_event_replayed_overwrites_same_alert_row(self):
        self.call("battery-last-call", battery())
        self.call("battery-last-call", battery())
        self.assertEqual(self.alerts.put[0]["sortKey"], self.alerts.put[1]["sortKey"])


class ProcessorPreservesEventFieldsTests(unittest.TestCase):
    def test_latest_is_updated_not_replaced(self):
        latest = FakeTable()
        snap = {"deviceId": "d1", "timestamp": TS, "batteryLevel": 50.0, "location": None}
        processor.put_latest(latest, snap)
        self.assertEqual(len(latest.updates), 1)
        self.assertEqual(latest.put, [])
        update = latest.updates[0]
        self.assertEqual(update["Key"], {"deviceId": "d1"})
        # Every field except the key is written; the key itself must stay out of the SET.
        self.assertEqual(set(update["ExpressionAttributeNames"].values()), set(snap) - {"deviceId"})


if __name__ == "__main__":
    unittest.main()
