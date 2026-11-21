import json
import os
import sys
import unittest
from decimal import Decimal
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from functions.query import handler as query  # noqa: E402

TS = "2026-11-21T14:02:10Z"
LOC = {"lat": Decimal("46.77"), "lon": Decimal("23.59"), "accuracyM": Decimal("8"), "capturedAt": "2026-11-21T14:02:08Z"}


class FakeTable:
    """Returns fixed items and records how it was queried or scanned."""

    def __init__(self, items=()):
        self.items = list(items)
        self.queries = []

    def query(self, **kwargs):
        self.queries.append(kwargs)
        return {"Items": self.items[: kwargs.get("Limit", len(self.items))]}

    def scan(self, **kwargs):
        return {"Items": self.items}


def alert_row(alert_type="connectivity_degraded", ts=TS, **extra):
    row = {
        "deviceId": "d1",
        "sortKey": f"{ts}#{alert_type}",
        "alertType": alert_type,
        "timestamp": ts,
        "receivedAt": "2026-11-21T14:02:11Z",
        "alertStatus": "OK",
        "alertReason": None,
        "batteryLevel": Decimal("0.64"),
        "location": LOC,
        "schemaVersion": Decimal("1"),
        "expiresAt": Decimal("1795868531"),
    }
    row.update(extra)
    return row


def latest_item(**extra):
    item = {
        "deviceId": "d1", "timestamp": TS, "batteryLevel": Decimal("64.0"), "isCharging": False,
        "activityState": "walking", "drainRatePerHour": Decimal("3.1"), "estimatedMinutesRemaining": 1238,
        "alertStatus": "OK", "alertReason": None, "travelStatus": "walking",
        "signal": {"level": Decimal("3"), "dbm": Decimal("-87"), "networkType": "cellular"},
        "presenceState": "ONLINE", "lastSeenAt": "2026-11-21T14:02:11Z",
    }
    item.update(extra)
    return item


class QueryTestCase(unittest.TestCase):
    def use_tables(self, **tables):
        """tables: env name -> FakeTable (e.g. ALERTS_TABLE=FakeTable([...]))."""
        patcher = mock.patch.object(query, "_table", side_effect=lambda env: tables[env])
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, resource, device_id=None, limit=None, path=None):
        event = {"resource": resource}
        if device_id:
            event["pathParameters"] = {"deviceId": device_id}
        if limit is not None:
            event["queryStringParameters"] = {"limit": limit}
        if path:
            event["path"] = path
        res = query.handler(event, None)
        return res["statusCode"], json.loads(res["body"])


class RoutingTests(QueryTestCase):
    def setUp(self):
        self.snapshots = FakeTable([{"timestamp": TS, "batteryLevel": Decimal("50")}])
        self.alerts = FakeTable([alert_row()])
        self.latest = FakeTable([latest_item()])
        self.use_tables(SNAPSHOTS_TABLE=self.snapshots, ALERTS_TABLE=self.alerts, LATEST_TABLE=self.latest)

    def test_each_route_reads_its_own_table(self):
        status, body = self.call("/api/devices")
        self.assertEqual((status, body[0]["deviceId"]), (200, "d1"))
        status, body = self.call("/api/devices/{deviceId}/telemetry", "d1")
        self.assertEqual(len(self.snapshots.queries), 1)
        self.assertNotIn("alertType", body["records"][0])
        status, body = self.call("/api/devices/{deviceId}/alerts", "d1")
        self.assertEqual(len(self.alerts.queries), 1)
        self.assertEqual(body["records"][0]["alertType"], "connectivity_degraded")

    def test_alerts_no_longer_falls_into_telemetry(self):
        self.call("/api/devices/{deviceId}/alerts", "d1")
        self.assertEqual(self.snapshots.queries, [])

    def test_unknown_route_is_404(self):
        status, body = self.call("/api/devices/{deviceId}/nope", "d1")
        self.assertEqual((status, body), (404, {"error": "Not found"}))

    def test_without_resource_the_path_still_resolves(self):
        query.handler({"pathParameters": {"deviceId": "d1"}, "path": "/api/devices/d1/alerts/"}, None)
        self.assertEqual(len(self.alerts.queries), 1)
        query.handler({"pathParameters": {"deviceId": "d1"}, "path": "/api/devices/d1/telemetry"}, None)
        self.assertEqual(len(self.snapshots.queries), 1)
        self.assertEqual(query.handler({}, None)["statusCode"], 200)  # no deviceId: the device list


class AlertsTests(QueryTestCase):
    def setUp(self):
        self.alerts = FakeTable([alert_row(), alert_row("battery_low", "2026-11-21T13:40:00Z",
                                                        alertStatus="WARNING", alertReason="Battery low",
                                                        batteryLevel=Decimal("0.19"))])
        self.use_tables(ALERTS_TABLE=self.alerts)

    def test_reads_one_device_newest_first_with_limit(self):
        self.call("/api/devices/{deviceId}/alerts", "d1", limit="20")
        q = self.alerts.queries[0]
        self.assertFalse(q["ScanIndexForward"])
        self.assertEqual(q["Limit"], 20)
        self.assertEqual(q["KeyConditionExpression"].get_expression()["values"][1], "d1")

    def test_default_and_capped_limit(self):
        self.call("/api/devices/{deviceId}/alerts", "d1")
        self.call("/api/devices/{deviceId}/alerts", "d1", limit="9999")
        self.assertEqual([q["Limit"] for q in self.alerts.queries], [50, 500])

    def test_invalid_limit_is_400(self):
        for bad in ("0", "-3", "abc"):
            status, body = self.call("/api/devices/{deviceId}/alerts", "d1", limit=bad)
            self.assertEqual((status, body), (400, {"error": "limit must be a positive integer"}))
        self.assertEqual(self.alerts.queries, [])

    def test_rows_are_cleaned_and_battery_is_percent(self):
        status, body = self.call("/api/devices/{deviceId}/alerts", "d1")
        self.assertEqual(status, 200)
        self.assertEqual(body["deviceId"], "d1")
        first, second = body["records"]
        for internal in ("sortKey", "expiresAt", "schemaVersion", "deviceId"):
            self.assertNotIn(internal, first)
        self.assertEqual(first["batteryLevel"], 64.0)
        self.assertEqual(second["batteryLevel"], 19.0)
        self.assertEqual(second["alertReason"], "Battery low")
        self.assertEqual(first["location"]["lat"], 46.77)  # Decimal -> JSON number

    def test_row_without_battery_is_left_alone(self):
        self.alerts.items = [alert_row("presence_offline", batteryLevel=None)]
        _, body = self.call("/api/devices/{deviceId}/alerts", "d1")
        self.assertIsNone(body["records"][0]["batteryLevel"])

    def test_no_alerts_is_empty_list(self):
        self.alerts.items = []
        status, body = self.call("/api/devices/{deviceId}/alerts", "unknown-phone")
        self.assertEqual((status, body), (200, {"deviceId": "unknown-phone", "records": []}))


class DeviceListTests(QueryTestCase):
    def test_last_call_and_signal_fields_are_returned(self):
        item = latest_item(lastCallType="battery", lastCallAt="2026-11-21T13:58:00Z",
                           lastKnownLocation=LOC, lastKnownHeading={"degrees": Decimal("274"), "speedMps": Decimal("1.3")})
        self.use_tables(LATEST_TABLE=FakeTable([item]))
        _, body = self.call("/api/devices")
        device = body[0]
        self.assertEqual(device["lastCallType"], "battery")
        self.assertEqual(device["lastCallAt"], "2026-11-21T13:58:00Z")
        self.assertEqual(device["lastKnownLocation"]["lon"], 23.59)
        self.assertEqual(device["lastKnownHeading"]["degrees"], 274)
        self.assertEqual(device["signal"], {"level": 3, "dbm": -87, "networkType": "cellular"})

    def test_missing_fields_are_null(self):
        self.use_tables(LATEST_TABLE=FakeTable([latest_item(signal=None)]))
        _, body = self.call("/api/devices")
        for field in ("lastCallType", "lastCallAt", "lastKnownLocation", "lastKnownHeading", "signal"):
            self.assertIsNone(body[0][field])

    def test_presence_fields_are_returned(self):
        self.use_tables(LATEST_TABLE=FakeTable([latest_item(presenceState="SUSPECT")]))
        _, body = self.call("/api/devices")
        self.assertEqual(body[0]["presenceState"], "SUSPECT")
        self.assertEqual(body[0]["lastSeenAt"], "2026-11-21T14:02:11Z")

    def test_presence_fields_null_when_missing(self):
        # e.g. a device that has not reported since liveness tracking was deployed:
        # null makes the dashboard fall back to its own staleness check.
        item = latest_item()
        del item["presenceState"], item["lastSeenAt"]
        self.use_tables(LATEST_TABLE=FakeTable([item]))
        _, body = self.call("/api/devices")
        self.assertIsNone(body[0]["presenceState"])
        self.assertIsNone(body[0]["lastSeenAt"])

    def test_history_records_have_no_presence_fields(self):
        self.use_tables(SNAPSHOTS_TABLE=FakeTable([latest_item()]))
        _, body = self.call("/api/devices/{deviceId}/telemetry", "d1")
        self.assertNotIn("presenceState", body["records"][0])

    def test_history_records_include_signal(self):
        self.use_tables(SNAPSHOTS_TABLE=FakeTable([latest_item()]))
        _, body = self.call("/api/devices/{deviceId}/telemetry", "d1")
        self.assertEqual(body["records"][0]["signal"]["level"], 3)
        self.assertNotIn("lastCallType", body["records"][0])


def path_snap(ts, lat="46.770", acc="5"):
    return {
        "deviceId": "d1", "timestamp": ts, "travelStatus": "walking",
        "location": {"lat": Decimal(lat), "lon": Decimal("23.590"), "accuracyM": Decimal(acc), "capturedAt": ts},
        "heading": {"degrees": Decimal("90"), "speedMps": Decimal("1.4")},
        "signal": {"level": Decimal("3"), "networkType": "cellular"},
    }


class PathTable:
    """History table for the path route: the newest-first lookup (Limit=1) returns `newest`;
    the window query returns `pages` one per call, linked by LastEvaluatedKey."""

    def __init__(self, newest=(), pages=((),)):
        self.newest, self.pages, self.queries = list(newest), [list(p) for p in pages], []

    def query(self, **kwargs):
        self.queries.append(kwargs)
        if kwargs.get("Limit") == 1:
            return {"Items": self.newest[:1]}
        page = len([q for q in self.queries if "Limit" not in q]) - 1
        out = {"Items": self.pages[page]}
        if page + 1 < len(self.pages):
            out["LastEvaluatedKey"] = {"deviceId": "d1", "timestamp": self.pages[page][-1]["timestamp"]}
        return out


class PathTests(QueryTestCase):
    ROUTE = "/api/devices/{deviceId}/path"

    def call_path(self, minutes=None, device_id="d1"):
        event = {"resource": self.ROUTE, "pathParameters": {"deviceId": device_id}}
        if minutes is not None:
            event["queryStringParameters"] = {"minutes": minutes}
        res = query.handler(event, None)
        return res["statusCode"], json.loads(res["body"])

    def use_history(self, table):
        self.use_tables(SNAPSHOTS_TABLE=table)
        return table

    def test_window_ends_at_newest_snapshot(self):
        newest = path_snap("2026-11-20T18:30:02Z")
        table = self.use_history(PathTable([newest], [[path_snap("2026-11-20T18:25:00Z"), newest]]))
        status, body = self.call_path("10")
        self.assertEqual(status, 200)
        self.assertEqual((body["deviceId"], body["minutes"]), ("d1", 10))
        self.assertEqual((body["from"], body["to"]), ("2026-11-20T18:20:02Z", "2026-11-20T18:30:02Z"))
        lookup, window = table.queries
        self.assertFalse(lookup["ScanIndexForward"])
        self.assertTrue(window["ScanIndexForward"])
        values = window["KeyConditionExpression"].get_expression()["values"]
        self.assertEqual(values[1].get_expression()["values"][1:], ("2026-11-20T18:20:02Z", "2026-11-20T18:30:02Z"))
        self.assertEqual([p["timestamp"] for p in body["points"]], ["2026-11-20T18:25:00Z", "2026-11-20T18:30:02Z"])
        self.assertEqual(body["summary"]["pointCount"], 2)

    def test_default_minutes_is_10(self):
        self.use_history(PathTable([path_snap("2026-11-20T18:30:02Z")]))
        _, body = self.call_path()
        self.assertEqual((body["minutes"], body["from"]), (10, "2026-11-20T18:20:02Z"))

    def test_presets_and_bounds_accepted(self):
        for minutes in ("1", "5", "20", "60", "120"):
            self.use_history(PathTable([path_snap("2026-11-20T18:30:02Z")]))
            status, body = self.call_path(minutes)
            self.assertEqual((status, body["minutes"]), (200, int(minutes)))

    def test_invalid_minutes_is_400_without_reading(self):
        table = self.use_history(PathTable())
        for bad in ("0", "-5", "121", "abc", "7.5", ""):
            status, body = self.call_path(bad)
            self.assertEqual((status, body), (400, {"error": "minutes must be an integer between 1 and 120"}))
        self.assertEqual(table.queries, [])

    def test_reads_every_page(self):
        pages = [[path_snap("2026-11-20T18:21:00Z")], [path_snap("2026-11-20T18:21:05Z")], [path_snap("2026-11-20T18:21:10Z")]]
        table = self.use_history(PathTable([path_snap("2026-11-20T18:21:10Z")], pages))
        _, body = self.call_path("5")
        window_queries = [q for q in table.queries if "Limit" not in q]
        self.assertEqual(len(window_queries), 3)
        self.assertNotIn("ExclusiveStartKey", window_queries[0])
        self.assertEqual(window_queries[1]["ExclusiveStartKey"]["timestamp"], "2026-11-20T18:21:00Z")
        self.assertEqual(body["summary"]["pointCount"], 3)

    def test_device_without_history(self):
        table = self.use_history(PathTable())
        status, body = self.call_path("5", device_id="unknown-phone")
        self.assertEqual((status, body), (200, {
            "deviceId": "unknown-phone", "minutes": 5, "from": None, "to": None, "points": [],
            "summary": {"pointCount": 0, "distanceM": 0.0, "durationSeconds": 0, "maxSpeedMps": None},
        }))
        self.assertEqual(len(table.queries), 1)  # only the newest-snapshot lookup

    def test_no_usable_fix_keeps_the_window(self):
        bad = path_snap("2026-11-20T18:30:02Z", acc="500")
        self.use_history(PathTable([bad], [[bad]]))
        _, body = self.call_path("5")
        self.assertEqual((body["from"], body["to"], body["points"]), ("2026-11-20T18:25:02Z", "2026-11-20T18:30:02Z", []))
        self.assertEqual(body["summary"]["pointCount"], 0)

    def test_points_are_plain_json(self):
        snap = path_snap("2026-11-20T18:30:02Z")
        self.use_history(PathTable([snap], [[snap]]))
        _, body = self.call_path("5")
        self.assertEqual(body["points"][0], {
            "timestamp": "2026-11-20T18:30:02Z", "lat": 46.77, "lon": 23.59, "accuracyM": 5,
            "heading": {"degrees": 90, "speedMps": 1.4}, "travelStatus": "walking",
            "signalLevel": 3, "gapBefore": False,
        })

    def test_without_resource_the_path_route_resolves(self):
        table = self.use_history(PathTable())
        res = query.handler({"pathParameters": {"deviceId": "d1"}, "path": "/api/devices/d1/path/"}, None)
        self.assertEqual(res["statusCode"], 200)
        self.assertEqual(len(table.queries), 1)


if __name__ == "__main__":
    unittest.main()
