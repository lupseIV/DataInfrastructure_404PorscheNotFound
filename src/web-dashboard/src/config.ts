// Runtime settings for the dashboard (master contract, Track 3).
// Values come from Vite env vars; see .env.example.

const env = import.meta.env;

export const config = {
  // Base URL of the query API (Contract C), e.g. https://<api-host>
  apiBaseUrl: (env.VITE_API_BASE_URL ?? "").replace(/\/+$/, ""),
  // USE_MOCK_DATA: serve sample data matching Contract C instead of calling the API.
  // Defaults to true so the UI works before the backend is deployed.
  useMockData: (env.VITE_USE_MOCK_DATA ?? "true").toLowerCase() !== "false",
  // Poll GET /api/devices and the selected device's telemetry every 5 seconds.
  pollIntervalMs: 5000,
  // A device is "Online" if lastUpdated is less than 30 seconds ago, otherwise "Stale".
  staleAfterMs: 30_000,
  // Number of history records requested from GET /api/devices/{deviceId}/telemetry.
  historyLimit: 50,
} as const;
