import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from handlers import query, rules, validation  # noqa: E402

TS = "2026-11-20T18:30:00Z"
TS2 = "2026-11-20T18:30:10Z"


def ev(event_type, value, unit, ts=TS):
    return {"deviceId": "d1", "eventType": event_type, "value": value, "unit": unit, "timestamp": ts}


def loc(lat=48.1374, lon=11.5755, acc=6.5):
    return ev("location", {"lat": lat, "lon": lon, "accuracyM": acc}, "deg")


def heading(speed, degrees=274.0, ts=TS):
    return ev("motion_heading", {"degrees": degrees, "speedMps": speed}, "deg", ts)


class LocationValidationTests(unittest.TestCase):
    def check(self, event):
        validation.validate_event(event)

    def test_valid_location_and_heading(self):
        self.check(loc())
        self.check(heading(1.4))

    def test_location_bounds(self):
        for bad in (loc(lat=91), loc(lat=-91), loc(lon=181), loc(acc=-1)):
            with self.assertRaises(validation.ValidationError):
                self.check(bad)

    def test_heading_bounds(self):
        for bad in (heading(-1), heading(1, degrees=361), heading(1, degrees=-1)):
            with self.assertRaises(validation.ValidationError):
                self.check(bad)

    def test_wrong_unit_rejected(self):
        bad = loc()
        bad["unit"] = "m"
        with self.assertRaises(validation.ValidationError):
            self.check(bad)


class LocationSnapshotTests(unittest.TestCase):
    def test_travel_status_from_speed(self):
        self.assertEqual(rules.derive_travel_status(None), "unknown")
        self.assertEqual(rules.derive_travel_status({"degrees": 0, "speedMps": 0.2}), "stationary")
        self.assertEqual(rules.derive_travel_status({"degrees": 0, "speedMps": 0.5}), "walking")
        self.assertEqual(rules.derive_travel_status({"degrees": 0, "speedMps": 4.9}), "walking")
        self.assertEqual(rules.derive_travel_status({"degrees": 0, "speedMps": 5.0}), "in_vehicle")

    def test_snapshot_without_location_is_null_and_unknown(self):
        snap = rules.build_snapshot("d1", TS, [ev("battery_level", 0.8, "ratio")], None)
        self.assertIsNone(snap["location"])
        self.assertIsNone(snap["heading"])
        self.assertEqual(snap["travelStatus"], "unknown")

    def test_snapshot_stores_location_with_captured_at(self):
        snap = rules.build_snapshot("d1", TS, [loc(), heading(12.3)], None)
        self.assertEqual(snap["location"], {"lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": TS})
        self.assertEqual(snap["heading"], {"degrees": 274.0, "speedMps": 12.3})
        self.assertEqual(snap["travelStatus"], "in_vehicle")

    def test_later_batch_without_location_keeps_previous(self):
        first = rules.build_snapshot("d1", TS, [loc(), heading(1.4)], None)
        second = rules.build_snapshot("d1", TS2, [ev("battery_level", 0.79, "ratio", TS2)], first)
        self.assertEqual(second["location"]["capturedAt"], TS)
        self.assertEqual(second["location"]["lat"], 48.1374)
        self.assertEqual(second["travelStatus"], "walking")

    def test_new_location_replaces_previous(self):
        first = rules.build_snapshot("d1", TS, [loc(), heading(1.4)], None)
        second = rules.build_snapshot("d1", TS2, [loc(lat=48.2), heading(0.0, ts=TS2)], first)
        self.assertEqual(second["location"]["lat"], 48.2)
        self.assertEqual(second["location"]["capturedAt"], TS2)
        self.assertEqual(second["travelStatus"], "stationary")


class LocationQueryTests(unittest.TestCase):
    def test_device_includes_location_fields(self):
        snap = rules.build_snapshot("d1", TS, [loc(), heading(1.4)], None)
        out = query.to_device(snap)
        self.assertEqual(out["location"]["lat"], 48.1374)
        self.assertEqual(out["travelStatus"], "walking")

    def test_old_item_without_location_returns_null(self):
        out = query.to_device({"deviceId": "d1", "timestamp": TS, "batteryLevel": 50})
        self.assertIsNone(out["location"])
        self.assertIsNone(out["travelStatus"])


if __name__ == "__main__":
    unittest.main()
