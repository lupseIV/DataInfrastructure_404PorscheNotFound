// Query API client (Contract C). With USE_MOCK_DATA on, it returns sample
// data instead of calling the server, so the rest of the UI doesn't care
// which one it gets.

import { config } from "./config";
import { getMockAlerts, getMockDevices, getMockTelemetry } from "./mock/mockData";
import type { Device, DeviceAlerts, DeviceTelemetry } from "./types";

export class ApiError extends Error {
  /** HTTP status, or null for network/configuration errors. */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const MOCK_DELAY_MS = 150; // simulate a short network round trip

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!config.apiBaseUrl) {
    throw new ApiError("VITE_API_BASE_URL is not set (or turn on VITE_USE_MOCK_DATA)");
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the API (network or CORS error)");
  }

  if (!response.ok) {
    let details = "";
    try {
      const body = (await response.json()) as { error?: string };
      details = body.error ? `: ${body.error}` : "";
    } catch {
      // body wasn't JSON; keep the status only
    }
    throw new ApiError(`API returned ${response.status}${details}`, response.status);
  }

  return (await response.json()) as T;
}

/** GET /api/devices — latest state of every device. */
export async function getDevices(signal?: AbortSignal): Promise<Device[]> {
  if (config.useMockData) {
    await wait(MOCK_DELAY_MS);
    return getMockDevices();
  }
  const devices = await getJson<Device[]>("/api/devices", signal);
  if (!Array.isArray(devices)) throw new ApiError("Unexpected response from /api/devices");
  return devices;
}

/** GET /api/devices/{deviceId}/telemetry?limit=N — history, newest first. */
export async function getDeviceTelemetry(
  deviceId: string,
  limit: number = config.historyLimit,
  signal?: AbortSignal,
): Promise<DeviceTelemetry> {
  if (config.useMockData) {
    await wait(MOCK_DELAY_MS);
    return getMockTelemetry(deviceId, limit);
  }
  const path = `/api/devices/${encodeURIComponent(deviceId)}/telemetry?limit=${limit}`;
  const telemetry = await getJson<DeviceTelemetry>(path, signal);
  if (!telemetry || !Array.isArray(telemetry.records)) {
    throw new ApiError("Unexpected response from the telemetry endpoint");
  }
  return telemetry;
}

/** Alerts of one device, plus whether the endpoint exists on this backend. */
export interface DeviceAlertsResult extends DeviceAlerts {
  /** false while the backend has no alerts route yet (API Gateway answers 403 or 404). */
  available: boolean;
}

/**
 * GET /api/devices/{deviceId}/alerts?limit=N — battery and connectivity events, newest first.
 * Documented in Contract C but not built yet: a missing route is reported as
 * `available: false` instead of an error, so the dashboard keeps working until it exists.
 */
export async function getDeviceAlerts(
  deviceId: string,
  limit: number = config.historyLimit,
  signal?: AbortSignal,
): Promise<DeviceAlertsResult> {
  if (config.useMockData) {
    await wait(MOCK_DELAY_MS);
    return { ...getMockAlerts(deviceId, limit), available: true };
  }
  const path = `/api/devices/${encodeURIComponent(deviceId)}/alerts?limit=${limit}`;
  try {
    const alerts = await getJson<DeviceAlerts>(path, signal);
    if (!alerts || !Array.isArray(alerts.records)) {
      throw new ApiError("Unexpected response from the alerts endpoint");
    }
    return { ...alerts, available: true };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return { deviceId, records: [], available: false };
    }
    throw err;
  }
}
