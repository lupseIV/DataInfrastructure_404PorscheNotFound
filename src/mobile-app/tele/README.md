# Fleet Telemetry — Mobile App (Contracts A, D1, D2)

Flutter app that reads **battery level**, **charging state**, **raw acceleration (incl. gravity)**
and **GPS location + heading**, and forwards them as raw events — zero on-device math. Every
`SEND_INTERVAL_SECONDS` (default 5) it POSTs one Contract A batch to `POST /api/telemetry`, and it
fires the Contract D1/D2 battery events on threshold crossings.

## Payload (Contract A batch)

```json
[
  { "deviceId": "fleet-phone-01", "eventType": "battery_level",  "value": 0.78,  "unit": "ratio",   "timestamp": "2026-11-20T18:30:00Z", "schemaVersion": 1 },
  { "deviceId": "fleet-phone-01", "eventType": "charging_state", "value": false, "unit": "boolean", "timestamp": "2026-11-20T18:30:00Z", "schemaVersion": 1 },
  { "deviceId": "fleet-phone-01", "eventType": "acceleration",   "value": {"x": 0.42, "y": 1.15, "z": 9.64}, "unit": "m/s2", "timestamp": "2026-11-20T18:30:00Z", "schemaVersion": 1 },
  { "deviceId": "fleet-phone-01", "eventType": "location",       "value": {"lat": 48.1374, "lon": 11.5755, "accuracyM": 6.5, "altitudeM": 519.0}, "unit": "deg", "timestamp": "2026-11-20T18:30:00Z", "schemaVersion": 1 },
  { "deviceId": "fleet-phone-01", "eventType": "motion_heading", "value": {"degrees": 274.0, "speedMps": 1.4}, "unit": "deg", "timestamp": "2026-11-20T18:30:00Z", "schemaVersion": 1 }
]
```

Headers: `Content-Type: application/json`, `x-api-key: <INGESTION_API_KEY>`.
`location` / `motion_heading` are included only once a GPS fix is available.

| Source | Package | Mapping |
|---|---|---|
| battery_level | `battery_plus` → `batteryLevel` (int 0–100) | `/ 100` → ratio 0.0–1.0 (only conversion; the OS returns a percentage) |
| charging_state | `battery_plus` → `batteryState` | `charging`, `full`, `connectedNotCharging` → `true` (plugged in) |
| acceleration | `sensors_plus` → `accelerometerEventStream()` | raw x/y/z incl. gravity, m/s² |
| location | `geolocator` → `getPositionStream()` | raw `lat`, `lon`, `accuracyM`, `altitudeM` |
| motion_heading | `geolocator` → `Position.heading` / `.speed` | raw `degrees` (0–360), `speedMps` (≥0) |

## Battery events (Contracts D1 / D2)

Separate POSTs (one object each), sent on threshold crossings while **unplugged**:

| Event | Endpoint | Fires when | Notes |
|---|---|---|---|
| Battery low (D1) | `POST /api/events/battery-low` | `battery ≤ 0.20` | status only |
| Battery last-call (D2) | `POST /api/events/battery-last-call` | `battery ≤ 0.10` | **jumps to the front** of the queue; adds `lastKnownLocation`, `pendingEventCount` |

Each fires **once** and re-arms after charging, or after the level climbs `0.05` above the threshold
(prevents re-sending on every tick). Body carries `batteryLevel` (ratio), `isCharging`,
`powerSaveMode`, `appState` (`foreground`/`background`), `location` + `heading`, and `schemaVersion`.
The device never computes a result — it only compares the raw value to a constant to decide *when* to send.

## Behaviour

- One Contract A batch every `SEND_INTERVAL_SECONDS` (default 5), all events sharing one UTC timestamp.
- Charger plugged/unplugged triggers an extra batch immediately.
- `202` → request removed from queue. Network error / 5xx → kept, retried with backoff 1, 2, 4, 8, 16, 30 s.
- `400` → request dropped (bad data never succeeds). `401` → kept, retried on next tick.
- Unified offline queue of up to **500 requests** (batches + D1/D2 events); oldest dropped on overflow.
  Last-call (D2) events are inserted at the front and replayed with their original `timestamp`.

## Setup

```bash
cd src/mobile-app/tele
flutter pub get
```

Required Android permissions (already in `android/app/src/main/AndroidManifest.xml`):

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
```

iOS uses `NSLocationWhenInUseUsageDescription` in `ios/Runner/Info.plist`. The app requests the
location permission at runtime on first launch; if denied, it keeps sending everything except
`location` / `motion_heading`.

## Run

The API key is passed at build time and is **never committed** (the repo is public).

```bash
flutter run \
  --dart-define=INGESTION_URL=https://<api-id>.execute-api.eu-west-1.amazonaws.com/prod/api/telemetry \
  --dart-define=INGESTION_API_KEY=<key>
```

`DEVICE_ID` is **optional**: when omitted, each install generates and persists its own unique id
(`fleet-phone-<hex>`) on first launch, so a single APK can be handed out and every phone reports as a
distinct device. Pass `DEVICE_ID` to pin a build to a known phone. The id is shown in the app header
(tap to copy). The event endpoints (`/api/events/*`) are derived from `INGESTION_URL` by replacing
the `/api/telemetry` suffix, so they share the same stage automatically.

Release APK for the demo (one build for everyone):

```bash
flutter build apk --release --dart-define=INGESTION_URL=... --dart-define=INGESTION_API_KEY=...
```

The APK lands at `build/app/outputs/flutter-apk/app-release.apk`. Use a **real phone** — emulators
return fake/flat sensor data and no GPS fix.

## Implementation status — extended contract

**✅ Done (this app):**
- Contract A: `battery_level`, `charging_state`, `acceleration`, **`location`**, **`motion_heading`**, with `schemaVersion`.
- Contract D1 (battery-low) and D2 (battery-last-call) events, with re-arm hysteresis and the priority (front-of-queue) offline queue.
- Per-install unique device id; app-lifecycle (`appState`) and `powerSaveMode` reporting.
- Offline queue, exponential backoff, original-timestamp replay.

**⬜ Not yet done (out of current scope):**
- **`signal_strength`** event (Contract A) — needs an Android platform channel for cellular bars/dBm; **not available on iOS** (Apple blocks it).
- **Contract E1 / E2** (connectivity degraded / last-call) — depend on `signal_strength`.
- Contract F (presence) is **cloud-only** — nothing required on the device.
- Surfacing the live GPS fix / battery-event activity in the app UI (currently backend-only).

## Testing without the backend

```bash
python tools/mock_ingest.py        # validates Contract A, key = dev-key, port 7071
flutter run --dart-define=INGESTION_URL=http://<laptop-ip>:7071/api/telemetry --dart-define=INGESTION_API_KEY=dev-key
```

Phone and laptop must be on the same WiFi. The mock prints every accepted event and returns the
exact 202 / 400 / 401 responses from the contract. (The mock only serves `/api/telemetry`; the
`/api/events/*` endpoints need the real backend.)
