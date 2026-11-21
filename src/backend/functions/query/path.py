"""Contract C #4: the device path for the map. Pure Python, no AWS access.

The query Lambda reads the history snapshots of the window and calls build_path, which
selects the points to draw and computes the summary. The dashboard only draws the result.
"""
import math
import os
from datetime import datetime, timedelta, timezone

DEFAULT_MAX_ACCURACY_M = 100.0
DEFAULT_GAP_SECONDS = 60
EARTH_RADIUS_M = 6_371_000.0
_TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"  # history timestamps are normalized to this exact form


def max_accuracy_m():
    """PATH_MAX_ACCURACY_M, read at call time like the other thresholds."""
    return float(os.environ.get("PATH_MAX_ACCURACY_M", DEFAULT_MAX_ACCURACY_M))


def gap_seconds():
    """PATH_GAP_SECONDS, read at call time like the other thresholds."""
    return int(os.environ.get("PATH_GAP_SECONDS", DEFAULT_GAP_SECONDS))


def parse_ts(ts):
    """ISO UTC string ending in Z (fractions tolerated) -> aware datetime."""
    return datetime.fromisoformat(ts[:-1] + "+00:00")


def window_start(to_ts, minutes):
    """Start of the window that ends at to_ts, in the history's timestamp format."""
    return (parse_ts(to_ts) - timedelta(minutes=minutes)).astimezone(timezone.utc).strftime(_TS_FORMAT)


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in meters between two WGS-84 points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _num(v):
    """DynamoDB Decimal (or int/float) -> int when whole, else float; None stays None."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def _heading(raw):
    if not raw:
        return None
    return {"degrees": _num(raw.get("degrees")), "speedMps": _num(raw.get("speedMps"))}


def _point(item, location):
    signal = item.get("signal") or {}
    return {
        "timestamp": location["capturedAt"],
        "lat": float(location["lat"]),
        "lon": float(location["lon"]),
        "accuracyM": _num(location.get("accuracyM")),
        "heading": _heading(item.get("heading")),
        "travelStatus": item.get("travelStatus"),
        "signalLevel": _num(signal.get("level")),
        "gapBefore": False,
    }


def _usable_fix(item, from_ts, max_acc):
    """The snapshot's location when it can be drawn, else None."""
    loc = item.get("location")
    if not loc or loc.get("lat") is None or loc.get("lon") is None or not loc.get("capturedAt"):
        return None
    # A fix carried forward from before the window does not belong to this path.
    if from_ts is not None and parse_ts(loc["capturedAt"]) < parse_ts(from_ts):
        return None
    acc = loc.get("accuracyM")
    if acc is not None and float(acc) > max_acc:
        return None
    return loc


def empty_summary():
    return {"pointCount": 0, "distanceM": 0.0, "durationSeconds": 0, "maxSpeedMps": None}


def build_path(items, from_ts=None, max_acc=None, gap_s=None):
    """Snapshots of the window (any order) -> (points oldest first, summary).

    - only snapshots with a usable location; each fix once (location.capturedAt changes)
    - fixes older than from_ts (carried forward into the window) and fixes with
      accuracyM > max_acc are dropped
    - gapBefore when the previous point is more than gap_s older; distance is not
      counted across a gap
    """
    max_acc = max_accuracy_m() if max_acc is None else max_acc
    gap_s = gap_seconds() if gap_s is None else gap_s

    points, seen, distance, prev_time = [], set(), 0.0, None
    for item in sorted(items, key=lambda i: i["timestamp"]):
        loc = _usable_fix(item, from_ts, max_acc)
        if loc is None or loc["capturedAt"] in seen:
            continue
        seen.add(loc["capturedAt"])
        point = _point(item, loc)
        t = parse_ts(point["timestamp"])
        if points:
            if (t - prev_time).total_seconds() > gap_s:
                point["gapBefore"] = True
            else:
                last = points[-1]
                distance += haversine_m(last["lat"], last["lon"], point["lat"], point["lon"])
        points.append(point)
        prev_time = t

    if not points:
        return [], empty_summary()
    speeds = [p["heading"]["speedMps"] for p in points if p["heading"] and p["heading"]["speedMps"] is not None]
    summary = {
        "pointCount": len(points),
        "distanceM": round(distance, 1),
        "durationSeconds": int((prev_time - parse_ts(points[0]["timestamp"])).total_seconds()),
        "maxSpeedMps": max(speeds) if speeds else None,
    }
    return points, summary
