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

/** Last `signal_strength` reading (Contract B `signal`), carried forward between batches. */
export interface DeviceSignal {
  level: number; // 0-4 bars
  dbm?: number | null; // missing on some networks
  networkType: NetworkType;
}

export type LastCallType = "battery" | "connectivity";

/** One item of GET /api/devices: the latest state of a device. */
export interface Device extends HealthSnapshot {
  deviceId: string;
  lastUpdated: string; // ISO-8601 UTC, device time of the latest snapshot
  // Optional: older backends don't send them, and every field has a fallback in the UI.
  location?: DeviceLocation | null; // null until the first GPS fix
  heading?: DeviceHeading | null;
  travelStatus?: TravelStatus | null;
  signal?: DeviceSignal | null; // null until the first reading, always on iOS

  // Latest-item only fields (Contract C #1): liveness (Contract F) and the last call (D2 / E2).
  presenceState?: PresenceState | null; // null: not tracked yet, the UI uses its own staleness check
  lastSeenAt?: string | null; // server receipt time of the last contact
  lastCallType?: LastCallType | null;
  lastCallAt?: string | null; // device time of that last call
  lastKnownLocation?: DeviceLocation | null; // position at the last call
  lastKnownHeading?: DeviceHeading | null;
}

/** One record of GET /api/devices/{deviceId}/telemetry. */
export interface TelemetryRecord extends HealthSnapshot {
  timestamp: string; // ISO-8601 UTC
  location?: DeviceLocation | null;
  heading?: DeviceHeading | null;
  travelStatus?: TravelStatus | null;
  signal?: DeviceSignal | null;
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
 * One record of GET /api/devices/{deviceId}/alerts (Contract C #3): the event as the phone sent
 * it plus the cloud-derived fields. Which extra fields a row has depends on its alertType.
 */
export interface AlertRecord {
  timestamp: string; // device time of the event (presence rows: server time)
  alertType: AlertType;
  receivedAt?: string | null; // server time
  batteryLevel?: number | null; // percent (the API converts the stored ratio); none on presence rows
  travelStatus?: TravelStatus | null;
  location?: DeviceLocation | null;
  lastKnownLocation?: DeviceLocation | null;
  heading?: DeviceHeading | null;
  alertStatus?: AlertStatus | null;
  alertReason?: string | null;
  signalLevel?: number | null;
  previousSignalLevel?: number | null;
  signalDbm?: number | null;
  previousSignalDbm?: number | null; // best dBm inside the window (E1)
  windowSeconds?: number | null; // E1
  networkType?: NetworkType | null;
  pendingEventCount?: number | null;
  // Presence rows (Contract F)
  lastSeenAt?: string | null;
  silentSeconds?: number | null; // presence_offline
  lastCallType?: LastCallType | null; // presence_offline: the last call that explains the silence
  offlineAlertSentAt?: string | null; // presence_recovered: when it went offline
}

/** Response of GET /api/devices/{deviceId}/alerts (records newest first). */
export interface DeviceAlerts {
  deviceId: string;
  records: AlertRecord[];
}
