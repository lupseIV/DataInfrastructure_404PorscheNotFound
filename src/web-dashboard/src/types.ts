// Response shapes of the query API (master contract, Contract C).

export type ActivityState = "stationary" | "walking" | "in_vehicle";

export type AlertStatus = "OK" | "WARNING" | "CRITICAL";

/** Health values shared by the device list and the history records. */
export interface HealthSnapshot {
  batteryLevel: number; // percent, 0-100
  isCharging: boolean;
  activityState: ActivityState;
  drainRatePerHour: number; // percent per hour
  estimatedMinutesRemaining: number | null; // null when charging or drain rate is 0
  alertStatus: AlertStatus;
  alertReason: string | null;
}

/** Cloud-derived movement, from GPS speed plus the acceleration classification. */
export type TravelStatus = ActivityState | "unknown";

/** Server-side liveness (Contract F): SUSPECT after 60 s of silence, OFFLINE after the grace period. */
export type PresenceState = "ONLINE" | "SUSPECT" | "OFFLINE";

/** Network the phone is on (Contract A `signal_strength.networkType`). */
export type NetworkType = "wifi" | "cellular" | "none";

export interface DeviceLocation {
  lat: number;
  lon: number;
  accuracyM: number; // meters
  capturedAt: string; // ISO-8601 UTC, device capture time of the fix
}

export interface DeviceHeading {
  degrees: number; // 0-360, 0 = north
  speedMps: number; // meters per second
}

/** One item of GET /api/devices: the latest state of a device. */
export interface Device extends HealthSnapshot {
  deviceId: string;
  lastUpdated: string; // ISO-8601 UTC
  // Added to Contract C with the location update. All optional: the backend may
  // not send them yet, and every field has a fallback in the UI.
  location?: DeviceLocation | null; // null until the first GPS fix
  heading?: DeviceHeading | null;
  travelStatus?: TravelStatus | null;
  presenceState?: PresenceState | null;
  lastSeenAt?: string | null; // server receipt time of the last event

  // NOT in Contract C yet (proposal). Named like the fields the backend already stores:
  // `signalLevel`, `lastKnownLocation`, `lastCallType` on the latest item (Contracts E1/E2,
  // D2), and `signalDbm` / `networkType` as in the E1/E2 bodies. Shown when present.
  signalLevel?: number | null; // 0-4 bars
  signalDbm?: number | null;
  networkType?: NetworkType | null;
  lastKnownLocation?: DeviceLocation | null; // position at the last "last call"
  lastCallType?: "battery" | "connectivity" | null;
}

/** One record of GET /api/devices/{deviceId}/telemetry. */
export interface TelemetryRecord extends HealthSnapshot {
  timestamp: string; // ISO-8601 UTC
}

/** Response of GET /api/devices/{deviceId}/telemetry (records newest first). */
export interface DeviceTelemetry {
  deviceId: string;
  records: TelemetryRecord[];
}

/** Event types stored in the alerts table (Contracts D1–E2) and presence alerts (Contract F). */
export type AlertType =
  | "battery_low"
  | "battery_last_call"
  | "connectivity_degraded"
  | "connectivity_last_call"
  | "presence_offline"
  | "presence_recovered";

/**
 * One record of GET /api/devices/{deviceId}/alerts (Contract C §3, documented, not built yet).
 * The contract lists the first fields; the rest are the event body fields the backend stores
 * on the same row, so they are optional.
 */
export interface AlertRecord {
  timestamp: string; // device time of the event
  alertType: AlertType;
  receivedAt?: string | null; // server time
  /** Contract example shows a percent (9.0); stored events hold a 0–1 ratio. Both are handled. */
  batteryLevel?: number | null;
  travelStatus?: TravelStatus | null;
  location?: DeviceLocation | null;
  lastKnownLocation?: DeviceLocation | null;
  heading?: DeviceHeading | null;
  alertStatus?: AlertStatus | null;
  alertReason?: string | null;
  signalLevel?: number | null;
  previousSignalLevel?: number | null;
  signalDbm?: number | null;
  networkType?: NetworkType | null;
  pendingEventCount?: number | null;
}

/** Response of GET /api/devices/{deviceId}/alerts (records newest first). */
export interface DeviceAlerts {
  deviceId: string;
  records: AlertRecord[];
}
