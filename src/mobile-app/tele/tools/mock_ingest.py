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
    if set(ev) != FIELDS:
        return f"[{i}] fields must be exactly {sorted(FIELDS)}, got {sorted(ev)}"
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
        self._send(202, {"accepted": len(events), "deviceId": events[0]["deviceId"]})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print(f"Mock ingestion on http://0.0.0.0:{PORT}/api/telemetry  (x-api-key: {API_KEY})")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
