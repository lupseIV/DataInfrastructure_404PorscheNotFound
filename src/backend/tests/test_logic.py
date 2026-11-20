import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handlers import ingest, rules, validation  # noqa: E402

TS = "2026-11-20T18:30:00Z"


def ev(et, value, unit, ts=TS, device="fleet-phone-01"):
    return {"deviceId": device, "eventType": et, "value": value, "unit": unit, "timestamp": ts}


def batch(level=0.785, charging=False, accel=None, ts=TS):
    return [
        ev("battery_level", level, "ratio", ts),
        ev("charging_state", charging, "boolean", ts),
        ev("acceleration", accel or {"x": 0.42, "y": 1.15, "z": 12.64}, "m/s2", ts),
    ]


class ValidationTests(unittest.TestCase):
    def bad(self, events):
        with self.assertRaises(validation.ValidationError):
            validation.validate_events(events)

    def test_valid_batch(self):
        validation.validate_events(batch())

    def test_rejects(self):
        self.bad([])
        self.bad([ev("battery_level", 1.5, "ratio")])
        self.bad([ev("battery_level", True, "ratio")])
        self.bad([ev("battery_level", 0.5, "percent")])
        self.bad([ev("charging_state", 1, "boolean")])
        self.bad([ev("acceleration", {"x": 1, "y": 2}, "m/s2")])
        self.bad([ev("acceleration", {"x": 1, "y": 2, "z": float("nan")}, "m/s2")])
        self.bad([ev("battery_level", 0.5, "ratio", ts="2026-11-20T18:30:00+00:00")])
        self.bad([ev("battery_level", 0.5, "ratio", device="")])
        self.bad([ev("gps", 1, "x")])

    def test_mobile_timestamp_format(self):
        validation.validate_events([ev("battery_level", 0.5, "ratio", "2026-11-20T18:30:00Z")])


class RulesTests(unittest.TestCase):
    def test_first_snapshot_matches_contract_example(self):
        s = rules.build_snapshot("fleet-phone-01", TS, batch(), None)
        self.assertEqual(s["batteryLevel"], 78.5)
        self.assertEqual(s["activityState"], "in_vehicle")
        self.assertEqual(s["drainRatePerHour"], 0.0)
        self.assertIsNone(s["estimatedMinutesRemaining"])
        self.assertEqual(s["alertStatus"], "OK")

    def test_drain_and_estimate(self):
        prev = rules.build_snapshot("d", "2026-11-20T18:00:00Z", batch(level=0.9), None)
        s = rules.build_snapshot("d", "2026-11-20T19:00:00Z", batch(level=0.8)[:2], prev)
        self.assertEqual(s["drainRatePerHour"], 10.0)
        self.assertEqual(s["estimatedMinutesRemaining"], 480)
        self.assertEqual(s["activityState"], "in_vehicle")  # retained axes

    def test_short_interval_keeps_previous_drain(self):
        prev = {"batteryLevel": 50.0, "isCharging": False, "drainRatePerHour": 7.0,
                "timestamp": "2026-11-20T18:00:00Z", "lastAccel": {"x": 0, "y": 0, "z": 9.81}}
        s = rules.build_snapshot("d", "2026-11-20T18:00:03Z", batch(level=0.49, ts="x")[:1], prev)
        self.assertEqual(s["drainRatePerHour"], 7.0)

    def test_alert_priority(self):
        self.assertEqual(rules.evaluate_alert(False, 10, "in_vehicle", 30)[1], "Critical battery level below 20%")
        self.assertEqual(rules.evaluate_alert(False, 50, "stationary", 30)[0], "CRITICAL")
        self.assertEqual(rules.evaluate_alert(False, 50, "stationary", 13)[0], "WARNING")
        self.assertEqual(rules.evaluate_alert(False, 30, "in_vehicle", 1)[0], "WARNING")
        self.assertEqual(rules.evaluate_alert(True, 5, "stationary", 99), ("OK", None))

    def test_normalize_timestamp(self):
        self.assertEqual(rules.normalize_timestamp("2026-11-20T18:30:00.123Z"), TS)


class IngestTests(unittest.TestCase):
    def call(self, body):
        sqs = mock.Mock()
        with mock.patch.object(ingest, "_client", return_value=sqs), \
                mock.patch.dict(os.environ, {"QUEUE_URL": "q"}):
            r = ingest.handler({"body": json.dumps(body)}, None)
        return r, sqs

    def test_accepts_mobile_batch(self):
        r, sqs = self.call(batch())
        self.assertEqual(r["statusCode"], 202)
        self.assertEqual(json.loads(r["body"]), {"accepted": 3, "deviceId": "fleet-phone-01"})
        kw = sqs.send_message.call_args.kwargs
        self.assertEqual(kw["MessageGroupId"], "fleet-phone-01")
        self.assertNotIn("MessageDeduplicationId", kw)

    def test_invalid_sends_nothing(self):
        r, sqs = self.call(batch(level=2))
        self.assertEqual(r["statusCode"], 400)
        self.assertEqual(json.loads(r["body"])["error"], "Validation failed")
        sqs.send_message.assert_not_called()


if __name__ == "__main__":
    unittest.main()
