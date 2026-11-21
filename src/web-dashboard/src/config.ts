// Runtime settings for the dashboard (master contract, Track 3).
//
// Where each value comes from, highest priority first:
//   1. public/config.json, fetched when the app starts. Edit it on the server to
//      change the API URL without rebuilding. Empty strings and nulls are ignored.
//   2. Vite env vars at build time (VITE_API_BASE_URL, VITE_USE_MOCK_DATA). The
//      deploy workflow sets VITE_API_BASE_URL from the AWS stack automatically.
//   3. The defaults below.
//
// Mock data is used only when explicitly turned on, or when no API URL is set.

export interface AppConfig {
  /** Base URL of the query API, e.g. https://abc123.execute-api.eu-central-1.amazonaws.com/prod */
  apiBaseUrl: string;
  /** Serve built-in sample data (Contract C) instead of calling the API. */
  useMockData: boolean;
  /** How often to poll GET /api/devices and the open device's telemetry. */
  pollIntervalMs: number;
  /** A device is Offline when its lastUpdated is this old or older. */
  staleAfterMs: number;
  /** Number of history records requested for the detail panel. */
  historyLimit: number;
  /** Map center [latitude, longitude] and zoom when the app opens. */
  mapCenter: [number, number];
  mapZoom: number;
}

type ConfigOverrides = { [K in keyof AppConfig]?: AppConfig[K] | null };

const env = import.meta.env;

const trimUrl = (url: string) => url.trim().replace(/\/+$/, "");

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

const envApiBaseUrl = trimUrl(env.VITE_API_BASE_URL ?? "");
const envUseMock = parseBool(env.VITE_USE_MOCK_DATA);

export const config: AppConfig = {
  apiBaseUrl: envApiBaseUrl,
  useMockData: envUseMock ?? envApiBaseUrl === "",
  pollIntervalMs: 5000,
  staleAfterMs: 30_000,
  historyLimit: 50,
  mapCenter: [46.7712, 23.6236], // Cluj-Napoca
  mapZoom: 13,
};

/** Where the runtime config was read from, shown in the UI for debugging. */
export let configSource: "config.json" | "build" = "build";

function isLatLng(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function applyOverrides(o: ConfigOverrides) {
  let urlChanged = false;
  if (typeof o.apiBaseUrl === "string" && o.apiBaseUrl.trim() !== "") {
    config.apiBaseUrl = trimUrl(o.apiBaseUrl);
    urlChanged = true;
  }

  const mock = parseBool(o.useMockData);
  if (mock !== undefined) config.useMockData = mock;
  else if (urlChanged && envUseMock === undefined) config.useMockData = false;

  if (isPositiveNumber(o.pollIntervalMs)) config.pollIntervalMs = o.pollIntervalMs;
  if (isPositiveNumber(o.staleAfterMs)) config.staleAfterMs = o.staleAfterMs;
  if (isPositiveNumber(o.historyLimit)) config.historyLimit = Math.round(o.historyLimit);
  if (isLatLng(o.mapCenter)) config.mapCenter = o.mapCenter;
  if (isPositiveNumber(o.mapZoom)) config.mapZoom = o.mapZoom;
}

/** Reads public/config.json (if present) and applies it over the build-time values. */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (response.ok) {
      const overrides = (await response.json()) as ConfigOverrides;
      if (overrides && typeof overrides === "object") {
        applyOverrides(overrides);
        configSource = "config.json";
      }
    }
  } catch {
    // No config.json or invalid JSON: keep the build-time values.
  }
  return config;
}
