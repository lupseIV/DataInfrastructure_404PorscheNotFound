# Fleet Telemetry — Mobile App (Contract A)

Flutter app that reads **battery level**, **charging state** and **raw acceleration (including gravity)**
and sends them as one batch of 3 events to `POST /api/telemetry` every 5 s.

## Payload (Contract A)

```json
[
  { "deviceId": "fleet-phone-01", "eventType": "battery_level",  "value": 0.78,  "unit": "ratio",   "timestamp": "2026-11-20T18:30:00Z" },
  { "deviceId": "fleet-phone-01", "eventType": "charging_state", "value": false, "unit": "boolean", "timestamp": "2026-11-20T18:30:00Z" },
  { "deviceId": "fleet-phone-01", "eventType": "acceleration",   "value": {"x": 0.42, "y": 1.15, "z": 9.64}, "unit": "m/s2", "timestamp": "2026-11-20T18:30:00Z" }
]
```

Headers: `Content-Type: application/json`, `x-api-key: <INGESTION_API_KEY>`.

| Source | Package | Mapping |
|---|---|---|
| battery_level | `battery_plus` → `batteryLevel` (int 0–100) | `/ 100` → ratio 0.0–1.0 (only conversion; the OS API returns a percentage) |
| charging_state | `battery_plus` → `batteryState` | `charging`, `full`, `connectedNotCharging` → `true` (plugged in, same as browser `battery.charging`) |
| acceleration | `sensors_plus` → `accelerometerEventStream()` | raw x/y/z incl. gravity, m/s² (same as `accelerationIncludingGravity`) |

## Behaviour

- Batch of 3 events every `SEND_INTERVAL_SECONDS` (default 5), all sharing one UTC timestamp.
- Charger plugged/unplugged triggers an extra batch immediately.
- `202` → removed from queue. Network error / 5xx → kept, retried with backoff 1, 2, 4, 8, 16, 30 s.
- `400` → batch dropped (bad data never succeeds). `401` → kept, retried on next tick.
- Offline queue up to 3000 events in memory; backlog flushed in chunks of 60 events.

## Setup

```bash
cd src/mobile                      # wherever this folder lives in the repo
flutter create --platforms=android,ios --project-name fleet_telemetry .   # generates android/ ios/, keeps lib/
flutter pub get
```

**Android** — in `android/app/src/main/AndroidManifest.xml` add inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

(Only for testing against the local mock over plain HTTP, also add `android:usesCleartextTraffic="true"` to `<application>`. Not needed for the Azure HTTPS endpoint.)

## Run

The API key is passed at build time and is **never committed** (the repo is public).

```bash
flutter run \
  --dart-define=INGESTION_URL=https://<your-app>.azurewebsites.net/api/telemetry \
  --dart-define=INGESTION_API_KEY=<key> \
  --dart-define=DEVICE_ID=fleet-phone-01
```

`DEVICE_ID` is **optional**: when omitted, each install generates and persists
its own unique id (`fleet-phone-<hex>`) on first launch, so a single APK can be
handed out and every phone reports as a distinct device. Pass `DEVICE_ID`
explicitly only to pin a build to a known phone. The id is shown in the app
header (tap to copy).

Release APK for the demo (one build for everyone):

```bash
flutter build apk --release --dart-define=INGESTION_URL=... --dart-define=INGESTION_API_KEY=...
```

The APK lands at `build/app/outputs/flutter-apk/app-release.apk`.

Use a **real phone** — emulators return fake/flat sensor data.

## Testing without the backend

```bash
python tools/mock_ingest.py        # validates Contract A, key = dev-key, port 7071
flutter run --dart-define=INGESTION_URL=http://<laptop-ip>:7071/api/telemetry --dart-define=INGESTION_API_KEY=dev-key
```

Phone and laptop must be on the same WiFi. The mock prints every accepted event and returns the
exact 202 / 400 / 401 responses from the contract.
