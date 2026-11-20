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
  * `timestamp`: ISO-8601 UTC `string` ending in `Z`.

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
  "alertReason": null
}
```

* **Field Types:**
  * `alertStatus`: `"OK" | "WARNING" | "CRITICAL"`
  * `alertReason`: `string | null`
  * `estimatedMinutesRemaining`: `integer | null` (`null` when charging or drain rate is $0$).

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
    "alertReason": null
  }
]
```

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

* **Environment Variable Contract (Injected via App Settings & GitHub Secrets):**
  * **Backend:** `DB_CONNECTION_STRING`, `INGESTION_API_KEY`, `ALLOWED_ORIGIN`
  * **Mobile App:** `VITE_API_BASE_URL`, `VITE_INGESTION_API_KEY`
  * **Web Dashboard:** `VITE_API_BASE_URL`

* **CI/CD Pipelines (`.github/workflows/`):**
  * `infra-deploy.yml`: Runs Bicep/Terraform deployment on changes to `infrastructure/`.
  * `app-deploy.yml`: Builds and deploys backend, mobile app, and web dashboard on push to `main`.