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

/** One item of GET /api/devices: the latest state of a device. */
export interface Device extends HealthSnapshot {
  deviceId: string;
  lastUpdated: string; // ISO-8601 UTC
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
