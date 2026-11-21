# Master Event Contracts & Parallel Business Logic

**Project:** Field Device & Mobile Fleet Health Monitoring

**Architecture Principle:** Zero-processing edge client; all unit conversions, vector math, state classifications, drain calculations, and alert evaluations execute in the cloud processing layer.

**Purpose:** Single source of truth for data contracts and isolated track business logic so all four components can be developed and AI-assisted in parallel without integration mismatches.

---

## 1. Master Event & API Contracts (Single Source of Truth)

All four tracks must adhere strictly to these schemas and endpoints so modules integrate without modification.

### Contract A: Mobile App $\rightarrow$ Cloud Ingestion (`POST /api/telemetry`)

The mobile app reads raw hardware/browser properties with zero arithmetic or unit conversion and packages each reading into the mandatory 5-field JSON structure (`deviceId`, `eventType`, `value`, `unit`, `timestamp` in UTC). The ingestion endpoint accepts either a **single event object** or a **JSON array of event objects** (recommended for batching all 3 raw sensor readings in one request).

* **Headers:**
  * `Content-Type: application/json`
  * `x-api-key: <INGESTION_API_KEY>`

* **Raw Telemetry Payload Schema:**

```json
[
  {
    "deviceId": "fleet-phone-01",
    "eventType": "battery_level",
    "value": 0.785,
    "unit": "ratio",
    "timestamp": "2026-11-20T18:30:00Z"
  },
  {
    "deviceId": "fleet-phone-01",
    "eventType": "charging_state",
    "value": false,
    "unit": "boolean",
    "timestamp": "2026-11-20T18:30:00Z"
  },
  {
    "deviceId": "fleet-phone-01",
    "eventType": "acceleration",
    "value": {
      "x": 0.42,
      "y": 1.15,
      "z": 12.64
    },
    "unit": "m/s2",
    "timestamp": "2026-11-20T18:30:00Z"
  }
]
```

* **Allowed Raw Event Types & Values:**
  * `deviceId`: non-empty `string` (e.g., `"fleet-phone-01"`).
  * `eventType` & corresponding `value` / `unit`:
    * `"battery_level"` $\rightarrow$ `value`: raw `number` ($0.0$ to $1.0$ directly from `battery.level`), `unit`: `"ratio"`
    * `"charging_state"` $\rightarrow$ `value`: `boolean` (`true` or `false` directly from `battery.charging`), `unit`: `"boolean"`
    * `"acceleration"` $\rightarrow$ `value`: raw `object` `{ "x": number, "y": number, "z": number }` (directly from `accelerationIncludingGravity.x`, `.y`, `.z`), `unit`: `"m/s2"`
    * `"location"` $\rightarrow$ `value`: raw `object` `{ "lat": number (-90..90), "lon": number (-180..180), "accuracyM": number (>= 0), "altitudeM"?: number }` (directly from the GPS fix), `unit`: `"deg"`. **Every device sends this event on every sampling cycle.**
    * `"motion_heading"` $\rightarrow$ `value`: raw `object` `{ "degrees": number (0..360), "speedMps": number (>= 0) }` (directly from GPS course/speed or compass, no math on the device), `unit`: `"deg"`
    * `"signal_strength"` $\rightarrow$ `value`: raw `object` `{ "level": integer (0..4), "dbm"?: number, "networkType": "wifi" | "cellular" | "none" }` (directly from the radio API), `unit`: `"bars"`
  * `timestamp`: ISO-8601 UTC `string` ending in `Z`. It is the **device capture time**: events replayed from the offline queue keep their original `timestamp`, and the cloud records its own receipt time separately (see Contract F).
  * `schemaVersion` (optional, `integer`, default `1`): top-level field on each event so the app and backend can evolve independently.

* **Cloud-derived fields (never sent by the device):** `travelStatus` (`"stationary" | "walking" | "in_vehicle" | "unknown"`) is computed in the cloud from the raw GPS `motion_heading.speedMps`: $< 0.5\text{ m/s} \rightarrow$ `"stationary"`, $0.5$ to $< 5\text{ m/s} \rightarrow$ `"walking"`, $\ge 5\text{ m/s} \rightarrow$ `"in_vehicle"`, and `"unknown"` until the first heading arrives. A batch without `location` or `motion_heading` keeps the previously stored values. In the snapshot, `location.capturedAt` is the event `timestamp`. The phone never classifies.

* **Location batch example (appended to a normal batch):**

```json
[
  {
    "deviceId": "fleet-phone-01",
    "eventType": "location",
    "value": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "altitudeM": 519.0 },
    "unit": "deg",
    "timestamp": "2026-11-20T18:30:00Z"
  },
  {
    "deviceId": "fleet-phone-01",
    "eventType": "motion_heading",
    "value": { "degrees": 274.0, "speedMps": 1.4 },
    "unit": "deg",
    "timestamp": "2026-11-20T18:30:00Z"
  },
  {
    "deviceId": "fleet-phone-01",
    "eventType": "signal_strength",
    "value": { "level": 3, "dbm": -92, "networkType": "cellular" },
    "unit": "bars",
    "timestamp": "2026-11-20T18:30:00Z"
  }
]
```

* **Responses:**
  * `202 Accepted`: `{ "accepted": 3, "deviceId": "fleet-phone-01" }`
  * `400 Bad Request`: `{ "error": "Validation failed", "details": "<reason>" }`
  * `401 Unauthorized`: `{ "error": "Invalid or missing x-api-key" }`

### Contract B: Cloud Processing $\rightarrow$ Database Persistence

The cloud processor transforms raw telemetry into a consolidated health snapshot and persists it in the cloud database:

```json
{
  "id": "fleet-phone-01_2026-11-20T18:30:00Z",
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:30:00Z",
  "batteryLevel": 78.5,
  "isCharging": false,
  "activityState": "in_vehicle",
  "drainRatePerHour": 9.4,
  "estimatedMinutesRemaining": 501,
  "alertStatus": "OK",
  "alertReason": null,
  "location": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": "2026-11-20T18:30:00Z" },
  "heading": { "degrees": 274.0, "speedMps": 1.4 },
  "travelStatus": "walking",
  "presenceState": "ONLINE",
  "lastSeenAt": "2026-11-20T18:30:02Z"
}
```

* **Field Types:**
  * `alertStatus`: `"OK" | "WARNING" | "CRITICAL"`
  * `alertReason`: `string | null`
  * `estimatedMinutesRemaining`: `integer | null` (`null` when charging or drain rate is $0$).
  * `location`: `object | null` (`{ lat, lon, accuracyM, capturedAt }`, `null` until the first fix arrives).
  * `heading`: `object | null` (`{ degrees, speedMps }`).
  * `travelStatus`: `"stationary" | "walking" | "in_vehicle" | "unknown"` (cloud-derived, see Contract A).
  * `presenceState`: `"ONLINE" | "SUSPECT" | "OFFLINE"` (see Contract F).
  * `lastSeenAt`: ISO-8601 UTC `string` (server receipt time of the last event), `null` for a device that never reported.

### Contract C: Cloud Query API $\rightarrow$ Web Dashboard

#### 1. Get All Devices & Latest Health (`GET /api/devices`)

Returns the latest processed state for each active device.

```json
[
  {
    "deviceId": "fleet-phone-01",
    "lastUpdated": "2026-11-20T18:30:00Z",
    "batteryLevel": 78.5,
    "isCharging": false,
    "activityState": "in_vehicle",
    "drainRatePerHour": 9.4,
    "estimatedMinutesRemaining": 501,
    "alertStatus": "OK",
    "alertReason": null,
    "location": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": "2026-11-20T18:30:00Z" },
    "heading": { "degrees": 274.0, "speedMps": 1.4 },
    "travelStatus": "walking",
    "presenceState": "ONLINE",
    "lastSeenAt": "2026-11-20T18:30:02Z"
  }
]
```

The new fields have the same types as in Contract B. Existing consumers may ignore them.

#### 2. Get Device Historical Events (`GET /api/devices/{deviceId}/telemetry?limit=50`)

Returns historical snapshots ordered by `timestamp` descending (newest first).

```json
{
  "deviceId": "fleet-phone-01",
  "records": [
    {
      "timestamp": "2026-11-20T18:30:00Z",
      "batteryLevel": 78.5,
      "isCharging": false,
      "activityState": "in_vehicle",
      "drainRatePerHour": 9.4,
      "estimatedMinutesRemaining": 501,
      "alertStatus": "OK",
      "alertReason": null
    }
  ]
}
```

#### 3. Get Device Alerts (`GET /api/devices/{deviceId}/alerts?limit=50`) — documented, not built yet

Returns the stored last-call and status events (Contracts D1 to E2) and presence alerts (Contract F), newest first.

```json
{
  "deviceId": "fleet-phone-01",
  "records": [
    {
      "timestamp": "2026-11-20T18:41:10Z",
      "alertType": "battery_last_call",
      "receivedAt": "2026-11-20T18:41:11Z",
      "batteryLevel": 9.0,
      "travelStatus": "in_vehicle",
      "location": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": "2026-11-20T18:41:08Z" },
      "heading": { "degrees": 274.0, "speedMps": 12.3 }
    }
  ]
}
```

* `alertType`: `"battery_low" | "battery_last_call" | "connectivity_degraded" | "connectivity_last_call" | "presence_offline" | "presence_recovered"`.

---

### Contract D1: Battery Low Status (`POST /api/events/battery-low`)

Sent once each time the battery drops to or below the **low threshold** (`BATTERY_LOW_THRESHOLD`, default `0.20`) while not charging. It re-arms when the device is charging or climbs back above the threshold plus `0.05`. This is a **status** event; it does not mean the device is about to die.

* **Headers:** `Content-Type: application/json`, `x-api-key: <INGESTION_API_KEY>`
* **Payload (raw values only, zero processing on the device):**

```json
{
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:35:00Z",
  "batteryLevel": 0.19,
  "isCharging": false,
  "powerSaveMode": false,
  "appState": "foreground",
  "location": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": "2026-11-20T18:34:58Z" },
  "heading": { "degrees": 274.0, "speedMps": 1.4 }
}
```

* **Field rules:**
  * `deviceId`: non-empty `string`. `timestamp`: ISO-8601 UTC ending in `Z`.
  * `batteryLevel`: number, $0.0 \le \text{value} \le 0.20$ (value above the threshold is `400`). `isCharging`: boolean, must be `false`.
  * `powerSaveMode`: boolean. `appState`: `"foreground" | "background"`.
  * `location`: `{ lat (-90..90), lon (-180..180), accuracyM (>= 0), capturedAt (ISO UTC) }`. `heading`: `{ degrees (0..360), speedMps (>= 0) }`. `location` is required (every device sends its location): a device with no GPS fix sends `location: null` plus `lastKnownLocation` (same shape), and at least one of the two must be present. `heading` is optional: it may be `null` or left out when there is no GPS fix, and the cloud then sets `travelStatus` to `"unknown"`.
* **Cloud processing:** adds `travelStatus`, `receivedAt`, evaluates the alert as `WARNING` (`alertReason = "Battery low"`), and stores the event in `ALERTS_TABLE` and the latest-state entry in `LATEST_TABLE`.
* **Responses:** `202 { "accepted": 1, "deviceId": "fleet-phone-01" }`, `400 { "error": "Validation failed", "details": "<reason>" }`, `401 { "error": "Invalid or missing x-api-key" }`.

### Contract D2: Battery Last Call (`POST /api/events/battery-last-call`)

A **separate event** sent once when the battery drops to or below the **last-call threshold** (`BATTERY_LAST_CALL_THRESHOLD`, default `0.10`) while not charging. Its purpose is to leave the team the best last-known state before the phone dies, so it is sent immediately, jumps to the front of the offline queue, and uses a minimal payload.

* **Payload:**

```json
{
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:41:10Z",
  "batteryLevel": 0.09,
  "isCharging": false,
  "powerSaveMode": true,
  "appState": "background",
  "location": { "lat": 48.1391, "lon": 11.5702, "accuracyM": 8.0, "capturedAt": "2026-11-20T18:41:08Z" },
  "heading": { "degrees": 274.0, "speedMps": 12.3 },
  "lastKnownLocation": { "lat": 48.1391, "lon": 11.5702, "accuracyM": 8.0, "capturedAt": "2026-11-20T18:41:08Z" },
  "pendingEventCount": 4
}
```

* **Field rules:** same as D1, except `batteryLevel` must be $\le 0.10$, and `lastKnownLocation` is required (it is the position and heading at the moment of the call). `pendingEventCount`: integer $\ge 0$, number of unsent events in the offline queue, so the cloud knows more data may follow.
* **Cloud processing:** adds `travelStatus` and `receivedAt`, evaluates the alert as `CRITICAL` (`alertReason = "Battery last call"`), stores the event in `ALERTS_TABLE`, and sets `lastKnownLocation` and `lastCallType = "battery"` in `LATEST_TABLE`. The presence logic (Contract F) uses this to explain a later silence as "likely battery dead".
* **Responses:** identical to D1.

### Contract E1: Connectivity Degraded (`POST /api/events/connectivity-degraded`)

Sent when the signal falls **quickly**: the level drops by at least `SIGNAL_DROP_BARS` (default `2`) or the `dbm` by at least `SIGNAL_DROP_DBM` (default `15`) inside `SIGNAL_DROP_WINDOW_SECONDS` (default `60`). It is **informational only** and never notifies the team. A slow or momentary drop sends nothing.

* **Payload:**

```json
{
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:38:00Z",
  "signalLevel": 1,
  "previousSignalLevel": 3,
  "signalDbm": -108,
  "windowSeconds": 45,
  "networkType": "cellular",
  "pendingEventCount": 2,
  "batteryLevel": 0.42,
  "location": { "lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "capturedAt": "2026-11-20T18:37:58Z" },
  "heading": { "degrees": 274.0, "speedMps": 1.4 }
}
```

* **Field rules:** `signalLevel` and `previousSignalLevel`: integers 0..4, with `previousSignalLevel - signalLevel >= 2` (or the dBm rule), otherwise `400`. `signalDbm`: optional number. `windowSeconds`: integer $1 \le \text{value} \le 60$. `networkType`: `"wifi" | "cellular" | "none"`. `pendingEventCount`: integer $\ge 0$. `batteryLevel`: ratio 0.0 to 1.0 so the cloud can correlate. `location` (or `lastKnownLocation`) is required and `heading` is optional (may be `null`), same rules as D1.
* **Cloud processing:** adds `travelStatus` and `receivedAt`, stores the event in `ALERTS_TABLE`, writes `signalLevel` to the latest entry, and feeds the coverage data. `alertStatus` is not changed.
* **Responses:** identical to D1.

### Contract E2: Connectivity Last Call (`POST /api/events/connectivity-last-call`)

A **separate event** sent when the connection is about to be lost: `signalLevel == 0`, or `signalDbm <= SIGNAL_LOST_DBM` (default `-110`). It is a minimal payload, since it may travel over a failing link. If the send fails it stays in the offline queue, and is replayed with its original `timestamp` when the connection returns (late arrival is allowed and is not an error).

* **Payload:**

```json
{
  "deviceId": "fleet-phone-01",
  "timestamp": "2026-11-20T18:39:05Z",
  "signalLevel": 0,
  "previousSignalLevel": 1,
  "signalDbm": -118,
  "networkType": "none",
  "pendingEventCount": 6,
  "batteryLevel": 0.41,
  "location": { "lat": 48.1380, "lon": 11.5740, "accuracyM": 9.0, "capturedAt": "2026-11-20T18:39:03Z" },
  "heading": { "degrees": 270.0, "speedMps": 1.2 },
  "lastKnownLocation": { "lat": 48.1380, "lon": 11.5740, "accuracyM": 9.0, "capturedAt": "2026-11-20T18:39:03Z" }
}
```

* **Field rules:** `signalLevel` must be `0` or `signalDbm <= -110` (otherwise `400`); `lastKnownLocation` is required; the other fields are as in E1 (`windowSeconds` is not required).
* **Cloud processing:** adds `travelStatus` and `receivedAt`, stores the event in `ALERTS_TABLE`, and sets `lastKnownLocation` and `lastCallType = "connectivity"` in `LATEST_TABLE`. It **does not alert the team on its own**: a short outage must not notify anyone, and the team alert is raised only by the presence logic in Contract F after the grace period.
* **Responses:** identical to D1.

### Contract F: Server-Side Presence (no device endpoint)

The phone cannot report its own silence, so the cloud detects it. A device that is quiet for a few seconds or a minute causes **no notification**; an alert is raised only once the device has been silent for at least the grace period (default 4 minutes).

* **Liveness fields (updated on every accepted event of any type, in `LATEST_TABLE`):**
  * `lastSeenAt`: server receipt time. Used for the liveness decision, because device clocks cannot be trusted.
  * `lastEventTimestamp`: device capture time. Used for event ordering and outage measurement.
  * `presenceState`: `"ONLINE" | "SUSPECT" | "OFFLINE"`.
  * `offlineAlertSentAt`: ISO UTC `string | null`, which makes the alert idempotent.

* **State machine:**

```
ONLINE ──silent > SUSPECT_AFTER_SECONDS──► SUSPECT ──silent >= grace──► OFFLINE (alert once)
   ▲                                          │                            │
   └───────────── any event arrives ──────────┴──── any event arrives ─────┘
                                                              └─► "presence_recovered" notice
```

  * **SUSPECT** is internal and notifies nobody.
  * **OFFLINE** raises one `presence_offline` alert and sets `offlineAlertSentAt`. The minute-by-minute sweep never re-alerts while the state is `OFFLINE`.
  * **Recovery:** any event moves the device to `ONLINE`. A `presence_recovered` notice is sent only if `offlineAlertSentAt` was set, and the field is cleared.
  * **Hysteresis:** after a recovery, the device must stay `ONLINE` for `RECOVERY_STABLE_SECONDS` before a new `OFFLINE` alert may fire (stops flapping).

* **Detection:** a scheduled `presence` Lambda (EventBridge, every minute) queries devices whose `lastSeenAt` is older than the grace period and whose state is not yet `OFFLINE`. **Adaptive grace:** `grace = max(OFFLINE_GRACE_SECONDS, 3 × usual heartbeat interval)`, so a device in power-save mode that reports less often is not flagged.

* **Cause inference** (stored in the alert and used in `alertReason`), from the last event received:
  * `lastCallType == "battery"` $\rightarrow$ `"Silent after battery last call (likely battery dead)"`
  * `lastCallType == "connectivity"` $\rightarrow$ `"Silent after connectivity last call (signal lost)"`
  * otherwise $\rightarrow$ `"Silent, cause unknown"`
  * The alert includes `lastKnownLocation` and the last `heading` exactly as last reported. The cloud does **not** predict or estimate the device's current position.

* **Late data:** on reconnect the phone replays its queue with old device timestamps. The cloud measures the real outage from timestamp gaps and records it in history; an outage shorter than the grace period is recorded but never alerted. The liveness decision always uses `lastSeenAt` and outage duration always uses the device timestamps.

* **Environment variables:** `SUSPECT_AFTER_SECONDS=60`, `OFFLINE_GRACE_SECONDS=240`, `RECOVERY_STABLE_SECONDS=120`.

### Environment Variables for Contracts D1 to F

* `BATTERY_LOW_THRESHOLD=0.20`, `BATTERY_LAST_CALL_THRESHOLD=0.10`
* `SIGNAL_DROP_BARS=2`, `SIGNAL_DROP_DBM=15`, `SIGNAL_LOST_DBM=-110`, `SIGNAL_DROP_WINDOW_SECONDS=60`
* `SUSPECT_AFTER_SECONDS=60`, `OFFLINE_GRACE_SECONDS=240`, `RECOVERY_STABLE_SECONDS=120`
* `ALERTS_TABLE` (events table, keyed by `deviceId` and `sortKey` = `<timestamp>#<alertType>`), `LATEST_TABLE` (existing), `ALLOWED_ORIGIN` (existing)

---

## 2. Parallel Track Specifications (Copy-Paste to AI)

Share **Section 1** alongside the assigned track specification below so each team member can build independently.

### Track 1: Mobile App (Zero-Processing Raw Sensor Forwarder)

* **Strict Rule:** Perform **no calculations, unit conversions, or state classifications** on the device. Only read raw values, wrap them in JSON, queue them, and send them over HTTPS.

* **Raw Inputs Read Directly:**
  * `deviceId`: Configurable string persisted in `localStorage` (default: `"fleet-phone-" + random4Digits`).
  * **Battery API (`navigator.getBattery()`):**
    * Read `battery.level` as-is ($0.0$ to $1.0$) $\rightarrow$ emit as `eventType: "battery_level"`, `unit: "ratio"`.
    * Read `battery.charging` as-is (`true` or `false`) $\rightarrow$ emit as `eventType: "charging_state"`, `unit: "boolean"`.
  * **Motion API (`window.addEventListener('devicemotion')`):**
    * Cache the latest raw `event.accelerationIncludingGravity` axes (`{ x, y, z }`, defaulting to `{ "x": 0, "y": 0, "z": 9.81 }` if unavailable on desktop).
    * Emit a single raw `acceleration` event with `value: { "x": x, "y": y, "z": z }` and `unit: "m/s2"`.
  * **Demo Fallback Controls (for desktop testing without physical sensors):** Raw input controls that directly set the raw values ($0.0$ to $1.0$ battery ratio, charging toggle, and raw `{ x, y, z }` presets) without performing math.

* **Sampling & Offline Retry Queue Business Logic:**
  * Sample every **10 seconds** (plus immediate emit whenever `battery.charging` changes).
  * Package the 3 raw events (`battery_level`, `charging_state`, `acceleration`) with `new Date().toISOString()` into a batch matching **Contract A**.
  * Store unsent batches in a FIFO `localStorage` queue (`maxSize = 500`, drop oldest on overflow).
  * Send oldest batch first via `POST /api/telemetry` with the `x-api-key` header.
  * On HTTP `202`: remove batch from queue and reset retry backoff to $1\text{ s}$.
  * On network failure or HTTP `5xx`: retain batch in queue and retry with exponential backoff ($1\text{ s} \rightarrow 2\text{ s} \rightarrow 4\text{ s} \rightarrow 8\text{ s} \rightarrow \max 30\text{ s}$).
  * Display only raw transmitted values, queue depth, and HTTP sync status on the mobile UI.

* **Location, Signal and Last-Call Triggers (Contracts A, D1 to E2):**
  * Every sampling cycle, also emit the raw `location`, `motion_heading` and `signal_strength` events in the same batch. **Every device sends its location.**
  * **Battery:** send Contract D1 once when `battery.level <= 0.20` and not charging; send Contract D2 once when `battery.level <= 0.10` and not charging. Re-arm D1 and D2 after charging starts or the level climbs 0.05 above the threshold. The only comparison done on the device is "raw value vs. constant threshold" to decide *when* to send, never to compute a result.
  * **Connectivity:** keep the last `signal_strength` readings of the past `SIGNAL_DROP_WINDOW_SECONDS` and send Contract E1 when the level drops by 2 bars or 15 dBm inside the window; send Contract E2 when `level == 0` or `dbm <= -110`. Raw values only.
  * Last-call events (D2, E2) go to the **front** of the offline queue; if the send fails they stay queued and are replayed with their original `timestamp`.
  * The device never raises a "device offline" alert itself (Contract F is cloud-only).

### Track 2: Cloud Processing & API Backend (All Transformations & Calculations)

* **Ingestion & Validation (`POST /api/telemetry`):**
  1. Verify `x-api-key` header matches environment variable `INGESTION_API_KEY` (return `401` if invalid).
  2. Normalize body into an array of events; validate every item has valid `deviceId`, `eventType`, `value`, `unit`, and ISO UTC `timestamp`, and verify value types/ranges:
     * `battery_level`: number where $0.0 \le \text{value} \le 1.0$
     * `charging_state`: boolean (`true` or `false`)
     * `acceleration`: object containing finite numeric `x`, `y`, and `z` properties (return `400` if invalid).
  3. Fetch the previous latest snapshot for `deviceId` from the database (if none exists, initialize defaults: `batteryLevel = 100.0`, `isCharging = false`, `activityState = "stationary"`, `drainRatePerHour = 0.0`).

* **Step 1 — Raw Signal Transformation (Executed in Cloud):**
  * **Battery Percentage (`batteryLevel`):**
    $$\text{batteryLevel} = \text{round}(\text{raw\_battery\_ratio} \times 100, 2)$$
  * **Charging Flag (`isCharging`):**
    $$\text{isCharging} = \text{Boolean}(\text{raw\_charging\_state})$$
  * **Acceleration Magnitude & Activity Classification (`activityState`):**
    Extract `x`, `y`, `z` from the `acceleration` event's `value` object (if omitted in a partial batch, retain the last known raw axis values or default to $x = 0, y = 0, z = 9.81$):
    $$a_{\text{mag}} = \sqrt{x^2 + y^2 + z^2}$$
    $$a_{\text{dyn}} = \left| a_{\text{mag}} - 9.81 \right|$$
    * If $a_{\text{dyn}} < 0.8 \rightarrow \text{activityState} = \text{"stationary"}$
    * If $0.8 \le a_{\text{dyn}} < 2.8 \rightarrow \text{activityState} = \text{"walking"}$
    * If $a_{\text{dyn}} \ge 2.8 \rightarrow \text{activityState} = \text{"in\_vehicle"}$

* **Step 2 — Drain Rate & Time-to-Empty Calculations:**
  * **Time Delta:**
    $$\Delta t_{\text{hours}} = \frac{\text{timestamp}_{\text{curr}} - \text{timestamp}_{\text{prev}}}{3,600,000\text{ ms}}$$
  * **Drain Rate (`drainRatePerHour`):**
    * If `isCharging == true` OR no previous record exists OR `batteryLevel >= prev.batteryLevel`: `drainRatePerHour = 0.0`.
    * Else if $\Delta t_{\text{hours}} < \frac{5}{3600}$ (under $5\text{ seconds}$): retain `prev.drainRatePerHour` to avoid division noise.
    * Else:
      $$\text{drainRatePerHour} = \text{round}\left(\frac{\text{prev.batteryLevel} - \text{batteryLevel}}{\Delta t_{\text{hours}}}, 2\right)$$
  * **Estimated Remaining Runtime (`estimatedMinutesRemaining`):**
    * If `isCharging == true` OR `drainRatePerHour <= 0`: `null`.
    * Else:
      $$\text{estimatedMinutesRemaining} = \text{round}\left(\left(\frac{\text{batteryLevel}}{\text{drainRatePerHour}}\right) \times 60\right)$$

* **Step 3 — Alert State Machine (Evaluated in Strict Priority Order):**
  1. **CRITICAL:** `isCharging == false` AND `batteryLevel < 20` $\rightarrow$ `alertReason = "Critical battery level below 20%"`
  2. **CRITICAL:** `isCharging == false` AND `drainRatePerHour > 25.0` $\rightarrow$ `alertReason = "Severe battery drain spike detected"`
  3. **WARNING:** `isCharging == false` AND `activityState == "stationary"` AND `drainRatePerHour > 12.0` $\rightarrow$ `alertReason = "Abnormal idle battery drain (thermal/background load risk)"`
  4. **WARNING:** `isCharging == false` AND `activityState == "in_vehicle"` AND `batteryLevel < 40` $\rightarrow$ `alertReason = "Device unplugged in vehicle transit below 40%"`
  5. **OK:** Otherwise $\rightarrow$ `alertStatus = "OK"`, `alertReason = null`.

* **Step 4 — Persistence & Query Serving:**
  * Persist snapshot matching **Contract B** and return `202 Accepted` with `{ "accepted": <count>, "deviceId": "<deviceId>" }`.
  * Implement `GET /api/devices` and `GET /api/devices/{deviceId}/telemetry` strictly matching **Contract C**.
  * Enable CORS for the Web Dashboard origin.

* **Event Handlers (one Lambda per event family, same structure as the existing handlers):** the two battery events share one Lambda and the two connectivity events share another. Each Lambda serves two routes and chooses the event from the request path (the last segment, e.g. `battery-low`); an unknown path returns `404`. The contracts, validation and stored `alertType` stay separate per event.
  * Every handler is a flat module in `src/backend/handlers/` with `def handler(event, context)`, a lazy boto3 client, env-var configuration, a shared `ValidationError`, pure-Python validation, and the API Gateway response shape (`statusCode`, `headers` with CORS, JSON `body`). Each is selected only by its handler string.

| Lambda (`${projectName}-<name>`) | Handler | Trigger | Contract |
|---|---|---|---|
| `battery` | `handlers.battery.handler` | API Gateway `POST /api/events/battery-low` and `POST /api/events/battery-last-call` | D1, D2 |
| `connectivity` | `handlers.connectivity.handler` | API Gateway `POST /api/events/connectivity-degraded` and `POST /api/events/connectivity-last-call` | E1, E2 |
| `presence` | `handlers.presence.handler` | EventBridge schedule, every minute | F |

  * Each event handler: (1) verify `x-api-key` (enforced by API Gateway, `401` otherwise); (2) parse and validate the body against its contract (`400` with `details` on failure); (3) add cloud-derived fields (`travelStatus`, `receivedAt`); (4) write the event to `ALERTS_TABLE` and update liveness fields (`lastSeenAt`, `lastEventTimestamp`, `lastKnownLocation`, `lastCallType`) in `LATEST_TABLE`; (5) return `202`. The `presence` handler follows Contract F and returns nothing to a caller.
  * Shared validators for `location`, `heading` and the common envelope are reused by all handlers; thresholds are read from env vars at call time, as with `QUEUE_URL` today.
  * The existing `ingest` and `processor` handlers also validate and process the new Contract A event types (`location`, `motion_heading`, `signal_strength`) and update `lastSeenAt`.

### Track 3: Web Dashboard (Frontend)

* **Data Fetching & State:**
  * Poll `GET /api/devices` every **5 seconds**.
  * Allow selecting a `deviceId` (auto-select the first device on load) and poll `GET /api/devices/{deviceId}/telemetry?limit=50` every **5 seconds**.
  * Include a `USE_MOCK_DATA` flag with sample data matching **Contract C** so UI development runs in parallel before backend deployment.

* **Required UI Sections:**
  1. **Device Context Bar:** Displays selected `deviceId`, active status badge (`Online` if `lastUpdated` $< 30\text{ s}$ ago, else `Stale`), `activityState` badge (`Stationary` / `Walking` / `In Vehicle`), and `isCharging` badge (`Charging` / `On Battery`).
  2. **Alert Banner:** Color-coded banner (`Green` = OK, `Amber` = WARNING, `Red` = CRITICAL) displaying `alertStatus` and `alertReason`.
  3. **Live KPI Cards:**
     * Latest `batteryLevel` ($\%$)
     * Current `drainRatePerHour` ($\%/\text{hr}$)
     * `estimatedMinutesRemaining` (formatted as `Xh Ym` or `Charging`)
     * `lastUpdated` formatted in UTC (`YYYY-MM-DD HH:mm:ss UTC`)
  4. **Historical Trend Chart:** Dual-line or multi-panel time-series chart plotting `batteryLevel` ($\%$) and `drainRatePerHour` ($\%/\text{hr}$) against `timestamp`.
  5. **Historical Events Table:** Reverse-chronological table showing `timestamp (UTC)`, `batteryLevel`, `isCharging`, `activityState`, `drainRatePerHour`, and `alertStatus`.

### Track 4: Infrastructure & DevOps (`infrastructure/` & CI/CD)

* **Repository Layout:**
  * `src/mobile/` (Mobile PWA)
  * `src/backend/` (Ingestion & Query API)
  * `src/web/` (Web Dashboard)
  * `infrastructure/` (Bicep or Terraform IaC templates)
  * `.github/workflows/` (Automated deployment workflows)

* **Azure Resources to Provision (`infrastructure/`):**
  * Resource Group
  * Azure Cosmos DB (Serverless / Free Tier) OR Azure Table Storage / Azure SQL for telemetry persistence
  * Azure Functions (or App Service) hosting the Backend API
  * Azure Static Web Apps (or App Service / Blob Static Website) hosting the Mobile PWA and Web Dashboard

* **Future Infrastructure for Contracts D1 to F (not built yet):**
  * **Note:** the repository now deploys to AWS with CDK (`infrastructure/`, TypeScript, API Gateway, SQS, DynamoDB, Lambda). The Azure resource list above is stale.
  * Four `POST /api/events/*` routes with API key required, two per Lambda: `battery` and `connectivity` (see Track 2). One `presence` Lambda with an EventBridge rule at `rate(1 minute)`.
  * An `ALERTS_TABLE` DynamoDB table (partition key `deviceId`, sort key `sortKey` = `<timestamp>#<alertType>`, TTL `expiresAt`), and the new names added to the `FUNCTIONS` list in `lambda-deploy.yml`.
  * Reserved concurrency: six Lambdas at 2 each (12) exceeds a new account's limit of 10 (set `lambdaReservedConcurrency` to `0` in that case).

* **Environment Variable Contract (Injected via App Settings & GitHub Secrets):**
  * **Backend:** `DB_CONNECTION_STRING`, `INGESTION_API_KEY`, `ALLOWED_ORIGIN`
  * **Mobile App:** `VITE_API_BASE_URL`, `VITE_INGESTION_API_KEY`
  * **Web Dashboard:** `VITE_API_BASE_URL`

* **CI/CD Pipelines (`.github/workflows/`):**
  * `infra-deploy.yml`: Runs Bicep/Terraform deployment on changes to `infrastructure/`.
  * `app-deploy.yml`: Builds and deploys backend, mobile app, and web dashboard on push to `main`.