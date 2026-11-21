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
