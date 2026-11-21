// Sample data matching Contract C, used when USE_MOCK_DATA is on.
// Timestamps are generated relative to "now" on every call, so the
// Online / Stale badge behaves like it will with the real API.
//
// The 12 devices cover every battery group and every alert the UI must show:
//   critical  fleet-phone-03 (CRITICAL, history shows the idle-drain WARNING before it), fleet-phone-06
//   low       fleet-phone-02 (WARNING: unplugged in vehicle), fleet-phone-09
//   medium    fleet-phone-05, fleet-phone-08, fleet-phone-10 (WARNING: idle drain)
//   high      fleet-phone-01, fleet-phone-04, fleet-phone-11
//   charging  fleet-phone-07
//   offline   fleet-phone-12 (no data for 5 minutes)
// No coordinates are sent, like the real backend, so the map uses approximate positions.

import type {
  ActivityState,
  AlertStatus,
  Device,
  DeviceTelemetry,
  HealthSnapshot,
  TelemetryRecord,
} from "../types";

interface MockProfile {
  deviceId: string;
  secondsSinceUpdate: number;
  batteryLevel: number;
  isCharging: boolean;
  activityState: ActivityState;
  drainRatePerHour: number;
}

const PROFILES: MockProfile[] = [
  { deviceId: "fleet-phone-01", secondsSinceUpdate: 3, batteryLevel: 78.5, isCharging: false, activityState: "walking", drainRatePerHour: 9.4 },
  { deviceId: "fleet-phone-02", secondsSinceUpdate: 4, batteryLevel: 34.0, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 14.8 },
  { deviceId: "fleet-phone-03", secondsSinceUpdate: 2, batteryLevel: 16.5, isCharging: false, activityState: "stationary", drainRatePerHour: 21.3 },
  { deviceId: "fleet-phone-04", secondsSinceUpdate: 5, batteryLevel: 92.0, isCharging: false, activityState: "stationary", drainRatePerHour: 4.1 },
  { deviceId: "fleet-phone-05", secondsSinceUpdate: 1, batteryLevel: 58.0, isCharging: false, activityState: "walking", drainRatePerHour: 8.2 },
  { deviceId: "fleet-phone-06", secondsSinceUpdate: 6, batteryLevel: 14.2, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 11.0 },
  { deviceId: "fleet-phone-07", secondsSinceUpdate: 2, batteryLevel: 88.0, isCharging: true, activityState: "stationary", drainRatePerHour: 0 },
  { deviceId: "fleet-phone-08", secondsSinceUpdate: 7, batteryLevel: 64.5, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 7.5 },
  { deviceId: "fleet-phone-09", secondsSinceUpdate: 3, batteryLevel: 29.5, isCharging: false, activityState: "walking", drainRatePerHour: 10.2 },
  { deviceId: "fleet-phone-10", secondsSinceUpdate: 4, batteryLevel: 48.0, isCharging: false, activityState: "stationary", drainRatePerHour: 13.4 },
  { deviceId: "fleet-phone-11", secondsSinceUpdate: 8, batteryLevel: 74.0, isCharging: false, activityState: "walking", drainRatePerHour: 6.8 },
  { deviceId: "fleet-phone-12", secondsSinceUpdate: 300, batteryLevel: 42.0, isCharging: false, activityState: "stationary", drainRatePerHour: 5.0 },
];

const SAMPLE_INTERVAL_SECONDS = 10; // the phone sends a batch every 10 s
const CHARGE_RATE_PER_HOUR = 30; // how fast a charging mock device gains battery
const MAX_RECORDS = 500;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Mock-only copy of the backend alert rules (Track 2, Step 3), so the sample
// history looks realistic. The real dashboard never computes alerts itself.
function mockAlert(s: Omit<HealthSnapshot, "alertStatus" | "alertReason">): {
  alertStatus: AlertStatus;
  alertReason: string | null;
} {
  if (!s.isCharging && s.batteryLevel < 20)
    return { alertStatus: "CRITICAL", alertReason: "Critical battery level below 20%" };
  if (!s.isCharging && s.drainRatePerHour > 25)
    return { alertStatus: "CRITICAL", alertReason: "Severe battery drain spike detected" };
  if (!s.isCharging && s.activityState === "stationary" && s.drainRatePerHour > 12)
    return {
      alertStatus: "WARNING",
      alertReason: "Abnormal idle battery drain (thermal/background load risk)",
    };
  if (!s.isCharging && s.activityState === "in_vehicle" && s.batteryLevel < 40)
    return { alertStatus: "WARNING", alertReason: "Device unplugged in vehicle transit below 40%" };
  return { alertStatus: "OK", alertReason: null };
}

/** Snapshot of a profile `stepsBack` samples before its latest one. */
function snapshotAt(p: MockProfile, stepsBack: number, now: number): TelemetryRecord {
  const secondsBack = p.secondsSinceUpdate + stepsBack * SAMPLE_INTERVAL_SECONDS;
  const hoursBack = (stepsBack * SAMPLE_INTERVAL_SECONDS) / 3600;

  const batteryLevel = p.isCharging
    ? round2(Math.max(0, p.batteryLevel - CHARGE_RATE_PER_HOUR * hoursBack))
    : round2(Math.min(100, p.batteryLevel + p.drainRatePerHour * hoursBack));

  // Small deterministic wobble so the drain-rate line isn't perfectly flat.
  const drainRatePerHour = p.isCharging
    ? 0
    : round2(p.drainRatePerHour * (1 + 0.08 * Math.sin(stepsBack / 3)));

  const estimatedMinutesRemaining =
    p.isCharging || drainRatePerHour <= 0
      ? null
      : Math.round((batteryLevel / drainRatePerHour) * 60);

  const base = {
    batteryLevel,
    isCharging: p.isCharging,
    activityState: p.activityState,
    drainRatePerHour,
    estimatedMinutesRemaining,
  };

  return {
    timestamp: new Date(now - secondsBack * 1000).toISOString(),
    ...base,
    ...mockAlert(base),
  };
}

export function getMockDevices(): Device[] {
  const now = Date.now();
  return PROFILES.map((p) => {
    const { timestamp, ...health } = snapshotAt(p, 0, now);
    return { deviceId: p.deviceId, lastUpdated: timestamp, ...health };
  });
}

export function getMockTelemetry(deviceId: string, limit: number): DeviceTelemetry {
  const profile = PROFILES.find((p) => p.deviceId === deviceId);
  if (!profile) return { deviceId, records: [] };

  const now = Date.now();
  const count = Math.min(Math.max(1, limit), MAX_RECORDS);
  const records = Array.from({ length: count }, (_, i) => snapshotAt(profile, i, now));
  return { deviceId, records }; // newest first, like the API
}
