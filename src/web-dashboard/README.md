# Web dashboard

Fleet health dashboard (React + Vite + TypeScript + Tailwind). It polls the query API
(Contract C) every 5 seconds and shows:

- **Status cards**: devices per battery group (Critical < 20 %, Low 20–40 %, Medium 40–70 %,
  High ≥ 70 %, Charging, Offline = no data for 30 s). Click a card to filter the list and the map.
- **Device list** (left): search, battery bar, charging and offline state. Click a device to select it.
- **Map**: every device as a marker colored by its battery group. Click a marker to open its details.
- **Detail panel** (right): the backend's alert and reason, battery %, drain rate, time remaining,
  motion state, last update (UTC), a battery/drain-rate chart and the recent events.

## Run locally

```bash
npm ci
npm run dev
```

Open http://localhost:5173/dashboard/. Without an API URL it runs on built-in sample data
(12 devices, marked "Mock data" in the top bar).

```bash
npm run build      # type-check and build to dist/
npm run preview    # serve the build
```

## Configuring the API URL

The dashboard reads its settings in this order (first one set wins):

1. **`public/config.json`** (served as `/dashboard/config.json`), read when the page loads.
   Change values here to point the dashboard somewhere else **without rebuilding**.
   Empty strings and `null` mean "not set".
2. **Build-time env vars**: `VITE_API_BASE_URL`, `VITE_USE_MOCK_DATA` (see `.env.example`).
   The deploy workflow sets `VITE_API_BASE_URL` from the AWS stack output automatically,
   so a new API URL is picked up on the next deploy with no code change.
3. Defaults in `src/config.ts`.

Mock data is used only when `useMockData` is `true`, or when no API URL is set at all.

| Key in `config.json` | Meaning | Default |
| --- | --- | --- |
| `apiBaseUrl` | Query API base URL including the stage, e.g. `https://abc123.execute-api.eu-central-1.amazonaws.com/prod` | from `VITE_API_BASE_URL` |
| `useMockData` | `true` / `false` to force sample data on or off | on only if no URL |
| `pollIntervalMs` | Refresh interval | `5000` |
| `mapCenter` | `[latitude, longitude]` the map opens on | Cluj-Napoca |
| `mapZoom` | Initial zoom | `13` |
| `mapTileUrl` / `mapTileAttribution` | Map tile server and its attribution | OpenStreetMap |
| `mapDarkFilter` | Darken light tiles to match the theme | `true` |

Example:

```json
{ "apiBaseUrl": "https://abc123.execute-api.eu-central-1.amazonaws.com/prod" }
```

Note: `aws s3 sync --delete` in the deploy workflow replaces `config.json` with the one in the
repo, and CloudFront caches it. After editing it directly in S3, invalidate `/dashboard/config.json`.

When testing a local dev server against the real API, the API's CORS setting (`ALLOWED_ORIGIN`)
must allow `http://localhost:5173`, otherwise the browser blocks the requests.

## Endpoints used

- `GET {apiBaseUrl}/api/devices`: latest state of every device
- `GET {apiBaseUrl}/api/devices/{deviceId}/telemetry?limit=50`: history of the open device

No API key is needed; only `POST /api/telemetry` (the phone) requires `x-api-key`.

## Map positions

Contract C has no coordinates yet, so each device is placed at a fixed **approximate**
position around `mapCenter` (derived from its ID), and the legend says so. If the API adds
`latitude` and `longitude` to the device objects, the map uses them automatically.

## Code layout

```
src/
  config.ts            runtime configuration (see above)
  api.ts               API client, switches between mock and live data
  types.ts             Contract C types
  mock/mockData.ts     sample devices and history
  hooks/usePolling.ts  polling that keeps the last good data on errors
  lib/status.ts        battery groups and alert colors
  lib/location.ts      device map positions
  lib/format.ts        number, duration and UTC time formatting
  components/          TopBar, StatusFilterBar, DeviceSidebar, FleetMap,
                       DeviceDetailPanel, BatteryChart, HistoryTable, ConnectionBanner
```

The design comes from the Stitch "Industrial Fleet Telemetry" design system
(dark slate surfaces, Inter for UI text, JetBrains Mono for numbers).
