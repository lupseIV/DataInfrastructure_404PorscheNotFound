"""Local mock of Contract A (POST /api/telemetry) to test the app before the
real Azure backend exists. Validates exactly like the contract says.

    python tools/mock_ingest.py            # listens on 0.0.0.0:7071
    API_KEY=secret python tools/mock_ingest.py

Android emulator -> http://10.0.2.2:7071/api/telemetry
Real phone on same WiFi -> http://<your-laptop-ip>:7071/api/telemetry
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

API_KEY = os.environ.get("API_KEY", "dev-key")
PORT = int(os.environ.get("PORT", "7071"))
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
FIELDS = {"deviceId", "eventType", "value", "unit", "timestamp"}


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(ev, i):
    if not isinstance(ev, dict):
        return f"[{i}] event must be an object"
    missing = FIELDS - set(ev)
    extra = set(ev) - FIELDS - {"schemaVersion"}  # schemaVersion is optional
    if missing or extra:
        return f"[{i}] fields must be {sorted(FIELDS)} (+optional schemaVersion), got {sorted(ev)}"
    if "schemaVersion" in ev and not isinstance(ev["schemaVersion"], int):
        return f"[{i}] schemaVersion must be an integer"
    if not isinstance(ev["deviceId"], str) or not ev["deviceId"]:
        return f"[{i}] deviceId must be a non-empty string"
    if not isinstance(ev["timestamp"], str) or not TS_RE.match(ev["timestamp"]):
        return f"[{i}] timestamp must be ISO-8601 UTC ending in Z"
    t, v, u = ev["eventType"], ev["value"], ev["unit"]
    if t == "battery_level":
        if not is_num(v) or not 0 <= v <= 1 or u != "ratio":
            return f"[{i}] battery_level needs number 0..1 and unit 'ratio'"
    elif t == "charging_state":
        if not isinstance(v, bool) or u != "boolean":
            return f"[{i}] charging_state needs boolean and unit 'boolean'"
    elif t == "acceleration":
        if (not isinstance(v, dict) or set(v) != {"x", "y", "z"}
                or not all(is_num(v[k]) for k in "xyz") or u != "m/s2"):
            return f"[{i}] acceleration needs {{x,y,z}} numbers and unit 'm/s2'"
    elif t == "location":
        if (not isinstance(v, dict) or not {"lat", "lon", "accuracyM"} <= set(v)
                or set(v) - {"lat", "lon", "accuracyM", "altitudeM"}
                or not is_num(v["lat"]) or not -90 <= v["lat"] <= 90
                or not is_num(v["lon"]) or not -180 <= v["lon"] <= 180
                or not is_num(v["accuracyM"]) or v["accuracyM"] < 0
                or ("altitudeM" in v and not is_num(v["altitudeM"])) or u != "deg"):
            return f"[{i}] location needs {{lat(-90..90),lon(-180..180),accuracyM>=0,altitudeM?}} and unit 'deg'"
    elif t == "motion_heading":
        if (not isinstance(v, dict) or set(v) != {"degrees", "speedMps"}
                or not is_num(v["degrees"]) or not 0 <= v["degrees"] <= 360
                or not is_num(v["speedMps"]) or v["speedMps"] < 0 or u != "deg"):
            return f"[{i}] motion_heading needs {{degrees(0..360),speedMps>=0}} and unit 'deg'"
    elif t == "signal_strength":
        if (not isinstance(v, dict) or not {"level", "networkType"} <= set(v)
                or set(v) - {"level", "dbm", "networkType"}
                or not isinstance(v["level"], int) or isinstance(v["level"], bool)
                or not 0 <= v["level"] <= 4
                or ("dbm" in v and not is_num(v["dbm"]))
                or v["networkType"] not in ("wifi", "cellular", "none") or u != "bars"):
            return f"[{i}] signal_strength needs {{level(0..4),dbm?,networkType}} and unit 'bars'"
    else:
        return f"[{i}] unknown eventType '{t}'"
    return None


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.rstrip("/") != "/api/telemetry":
            return self._send(404, {"error": "Not found"})
        if self.headers.get("x-api-key") != API_KEY:
            return self._send(401, {"error": "Invalid or missing x-api-key"})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            payload = json.loads(raw)
        except Exception as e:
            return self._send(400, {"error": "Validation failed", "details": f"invalid JSON: {e}"})
        events = payload if isinstance(payload, list) else [payload]
        if not events:
            return self._send(400, {"error": "Validation failed", "details": "empty array"})
        for i, ev in enumerate(events):
            err = validate(ev, i)
            if err:
                print("400", err)
                return self._send(400, {"error": "Validation failed", "details": err})
        for ev in events:
            print(ev["timestamp"], ev["deviceId"], ev["eventType"], ev["value"])
            if ev["eventType"] == "location":
                v = ev["value"]
                print(f"    -> https://www.google.com/maps?q={v['lat']},{v['lon']}"
                      f"  (±{v['accuracyM']} m)")
        self._send(202, {"accepted": len(events), "deviceId": events[0]["deviceId"]})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print(f"Mock ingestion on http://0.0.0.0:{PORT}/api/telemetry  (x-api-key: {API_KEY})")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
