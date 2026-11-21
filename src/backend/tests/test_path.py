import os
import sys
import unittest
from decimal import Decimal
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from functions.query import path  # noqa: E402

# ~111 m per 0.001 degree of latitude
LAT, LON = 46.770, 23.590


def snap(ts, lat=LAT, lon=LON, acc="5", captured=None, speed="1.4", level=3, location=True):
    """A history snapshot as DynamoDB returns it (numbers as Decimal)."""
    item = {
        "deviceId": "phone-1",
        "timestamp": ts,
        "travelStatus": "walking",
        "heading": {"degrees": Decimal("90"), "speedMps": Decimal(speed)} if speed is not None else None,
        "signal": {"level": Decimal(level), "networkType": "cellular"} if level is not None else None,
    }
    if location:
        item["location"] = {
            "lat": Decimal(str(lat)), "lon": Decimal(str(lon)),
            "accuracyM": Decimal(acc), "capturedAt": captured or ts,
        }
    return item


class HaversineTests(unittest.TestCase):
    def test_zero_for_same_point(self):
        self.assertEqual(path.haversine_m(LAT, LON, LAT, LON), 0.0)

    def test_one_millidegree_latitude_is_about_111_m(self):
        self.assertAlmostEqual(path.haversine_m(LAT, LON, LAT + 0.001, LON), 111.19, places=1)


class WindowTests(unittest.TestCase):
    def test_window_start(self):
        self.assertEqual(path.window_start("2026-11-20T18:30:02Z", 10), "2026-11-20T18:20:02Z")

    def test_window_crosses_midnight(self):
        self.assertEqual(path.window_start("2026-11-21T00:03:00Z", 5), "2026-11-20T23:58:00Z")


class BuildPathTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(path.build_path([], max_acc=100, gap_s=60), ([], path.empty_summary()))

    def test_points_oldest_first_with_fields(self):
        items = [snap("2026-11-20T18:20:10Z", lat=LAT + 0.001), snap("2026-11-20T18:20:05Z")]
        points, summary = path.build_path(items, max_acc=100, gap_s=60)
        self.assertEqual([p["timestamp"] for p in points], ["2026-11-20T18:20:05Z", "2026-11-20T18:20:10Z"])
        self.assertEqual(points[0], {
            "timestamp": "2026-11-20T18:20:05Z", "lat": LAT, "lon": LON, "accuracyM": 5,
            "heading": {"degrees": 90, "speedMps": 1.4}, "travelStatus": "walking",
            "signalLevel": 3, "gapBefore": False,
        })
        self.assertEqual(summary["pointCount"], 2)
        self.assertAlmostEqual(summary["distanceM"], 111.2, places=1)
        self.assertEqual(summary["durationSeconds"], 5)
        self.assertEqual(summary["maxSpeedMps"], 1.4)

    def test_carried_forward_fix_counted_once(self):
        fix = "2026-11-20T18:20:05Z"
        items = [snap(fix), snap("2026-11-20T18:20:10Z", captured=fix), snap("2026-11-20T18:20:15Z", captured=fix)]
        points, summary = path.build_path(items, max_acc=100, gap_s=60)
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["timestamp"], fix)
        self.assertEqual(summary["durationSeconds"], 0)

    def test_fix_from_before_window_dropped(self):
        items = [snap("2026-11-20T18:20:05Z", captured="2026-11-20T18:19:00Z"), snap("2026-11-20T18:20:10Z")]
        points, _ = path.build_path(items, from_ts="2026-11-20T18:20:02Z", max_acc=100, gap_s=60)
        self.assertEqual([p["timestamp"] for p in points], ["2026-11-20T18:20:10Z"])

    def test_inaccurate_fix_dropped(self):
        items = [snap("2026-11-20T18:20:05Z", acc="150"), snap("2026-11-20T18:20:10Z", acc="100")]
        points, _ = path.build_path(items, max_acc=100, gap_s=60)
        self.assertEqual([p["timestamp"] for p in points], ["2026-11-20T18:20:10Z"])

    def test_snapshot_without_location_skipped(self):
        items = [snap("2026-11-20T18:20:05Z", location=False), snap("2026-11-20T18:20:10Z")]
        points, _ = path.build_path(items, max_acc=100, gap_s=60)
        self.assertEqual(len(points), 1)

    def test_gap_flag_and_no_distance_across_gap(self):
        items = [
            snap("2026-11-20T18:20:00Z"),
            snap("2026-11-20T18:20:30Z", lat=LAT + 0.001),   # 30 s later: joined
            snap("2026-11-20T18:21:31Z", lat=LAT + 0.010),   # 61 s later: gap, ~1 km not counted
            snap("2026-11-20T18:22:31Z", lat=LAT + 0.011),   # exactly 60 s: joined
        ]
        points, summary = path.build_path(items, max_acc=100, gap_s=60)
        self.assertEqual([p["gapBefore"] for p in points], [False, False, True, False])
        self.assertAlmostEqual(summary["distanceM"], 222.4, places=1)
        self.assertEqual(summary["durationSeconds"], 151)

    def test_max_speed_none_without_headings(self):
        points, summary = path.build_path([snap("2026-11-20T18:20:05Z", speed=None, level=None)], max_acc=100, gap_s=60)
        self.assertIsNone(points[0]["heading"])
        self.assertIsNone(points[0]["signalLevel"])
        self.assertIsNone(summary["maxSpeedMps"])

    def test_thresholds_read_from_env_at_call_time(self):
        items = [snap("2026-11-20T18:20:00Z", acc="40"), snap("2026-11-20T18:20:20Z")]
        with mock.patch.dict(os.environ, {"PATH_MAX_ACCURACY_M": "30", "PATH_GAP_SECONDS": "10"}):
            points, _ = path.build_path(items)
        self.assertEqual([p["timestamp"] for p in points], ["2026-11-20T18:20:20Z"])
        with mock.patch.dict(os.environ, {"PATH_GAP_SECONDS": "10"}):
            points, _ = path.build_path(items)
        self.assertEqual([p["gapBefore"] for p in points], [False, True])


if __name__ == "__main__":
    unittest.main()
