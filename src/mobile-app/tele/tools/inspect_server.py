"""Local test receiver for Contract A.

- POST /api/telemetry   -> validates exactly like the contract, answers 202/400/401
- every request (good or bad) is saved to telemetry.db (SQLite)
- GET /                 -> web page: raw JSON of each request + validation result + stored events
- GET /api/events       -> stored events as JSON

Run:   python tools/inspect_server.py            (key = dev-key, port 7071)
Open:  http://localhost:7071
App:   emulator  -> http://10.0.2.2:7071/api/telemetry
       real phone -> http://<laptop-ip>:7071/api/telemetry
"""
import html
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = os.environ.get("API_KEY", "dev-key")
PORT = int(os.environ.get("PORT", "7071"))
DB = os.environ.get("DB", "telemetry.db")
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
FIELDS = {"deviceId", "eventType", "value", "unit", "timestamp"}


def db():
    con = sqlite3.connect(DB)
    con.execute("""CREATE TABLE IF NOT EXISTS requests(
        id INTEGER PRIMARY KEY, received_at TEXT, status INTEGER, error TEXT, raw_body TEXT)""")
    con.execute("""CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY, request_id INTEGER, device_id TEXT, event_type TEXT,
        value TEXT, unit TEXT, timestamp TEXT)""")
    return con


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


def page():
    con = db()
    reqs = con.execute(
        "SELECT id, received_at, status, error, raw_body FROM requests ORDER BY id DESC LIMIT 30").fetchall()
    latest = con.execute("""SELECT device_id, event_type, value, unit, timestamp FROM events
        WHERE id IN (SELECT MAX(id) FROM events GROUP BY device_id, event_type)
        ORDER BY device_id, event_type""").fetchall()
    counts = con.execute(
        "SELECT status, COUNT(*) FROM requests GROUP BY status").fetchall()
    n_events = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    con.close()

    e = html.escape
    latest_rows = "".join(
        f"<tr><td>{e(d)}</td><td>{e(t)}</td><td><code>{e(v)}</code></td><td>{e(u)}</td><td>{e(ts)}</td></tr>"
        for d, t, v, u, ts in latest) or "<tr><td colspan=5>No events yet</td></tr>"
    count_txt = " · ".join(f"<b>{s}</b>: {c}" for s, c in counts) or "none"

    req_html = ""
    for rid, at, status, err, body in reqs:
        try:
            pretty = json.dumps(json.loads(body), indent=2)
        except Exception:
            pretty = body
        cls = "ok" if status == 202 else "bad"
        req_html += f"""<div class="req {cls}">
          <div><b>#{rid}</b> {e(at)} → <b>{status}</b> {e(err or '')}</div>
          <pre>{e(pretty)}</pre></div>"""

    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="3"><title>Telemetry inspector</title>
<style>
 body{{font-family:system-ui,sans-serif;margin:24px;max-width:1100px}}
 table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #ddd;padding:6px 8px;text-align:left}}
 th{{background:#f4f4f6}} pre{{background:#f7f7f9;padding:8px;overflow:auto;margin:6px 0 0;font-size:12px}}
 .req{{border-left:5px solid #ccc;padding:8px 12px;margin:10px 0;background:#fff}}
 .ok{{border-color:#2e7d32}} .bad{{border-color:#c62828}}
</style></head><body>
<h2>Telemetry inspector</h2>
<p>Requests by status: {count_txt} · events stored: <b>{n_events}</b> · DB: <code>{e(os.path.abspath(DB))}</code> · auto-refresh 3 s</p>
<h3>Latest value per device / event type</h3>
<table><tr><th>deviceId</th><th>eventType</th><th>value</th><th>unit</th><th>timestamp</th></tr>{latest_rows}</table>
<h3>Last 30 requests (raw body as received)</h3>{req_html or '<p>No requests yet</p>'}
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _log(self, status, error, raw, events=None):
        con = db()
        cur = con.execute(
            "INSERT INTO requests(received_at, status, error, raw_body) VALUES (?,?,?,?)",
            (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"), status, error, raw))
        for ev in events or []:
            con.execute(
                "INSERT INTO events(request_id, device_id, event_type, value, unit, timestamp) VALUES (?,?,?,?,?,?)",
                (cur.lastrowid, ev["deviceId"], ev["eventType"], json.dumps(ev["value"]), ev["unit"], ev["timestamp"]))
        con.commit()
        con.close()
        print(status, error or f"{len(events or [])} events")

    def do_GET(self):
        if self.path == "/":
            return self._send(200, page(), "text/html; charset=utf-8")
        if self.path == "/api/events":
            con = db()
            rows = con.execute(
                "SELECT device_id, event_type, value, unit, timestamp FROM events ORDER BY id DESC LIMIT 500").fetchall()
            con.close()
            return self._send(200, [
                {"deviceId": d, "eventType": t, "value": json.loads(v), "unit": u, "timestamp": ts}
                for d, t, v, u, ts in rows])
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/telemetry":
            return self._send(404, {"error": "Not found"})
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", "replace")

        if self.headers.get("x-api-key") != API_KEY:
            self._log(401, "Invalid or missing x-api-key", raw)
            return self._send(401, {"error": "Invalid or missing x-api-key"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            self._log(400, "Content-Type must be application/json", raw)
            return self._send(400, {"error": "Validation failed", "details": "Content-Type must be application/json"})
        try:
            payload = json.loads(raw)
        except Exception as ex:
            self._log(400, f"invalid JSON: {ex}", raw)
            return self._send(400, {"error": "Validation failed", "details": f"invalid JSON: {ex}"})

        events = payload if isinstance(payload, list) else [payload]
        if not events:
            self._log(400, "empty array", raw)
            return self._send(400, {"error": "Validation failed", "details": "empty array"})
        for i, ev in enumerate(events):
            err = validate(ev, i)
            if err:
                self._log(400, err, raw)
                return self._send(400, {"error": "Validation failed", "details": err})

        self._log(202, None, raw, events)
        self._send(202, {"accepted": len(events), "deviceId": events[0]["deviceId"]})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    db().close()
    print(f"Receiver:  http://0.0.0.0:{PORT}/api/telemetry   (x-api-key: {API_KEY})")
    print(f"Inspector: http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()