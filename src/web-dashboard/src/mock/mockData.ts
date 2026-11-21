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
//   offline   fleet-phone-12 (no data for 5 minutes, server presence OFFLINE)
// fleet-phone-09 has been silent for 75 s, so the server marks it SUSPECT.
// fleet-phone-04 has no GPS fix yet (location: null), so the map places it approximately.
// Walking and in-vehicle devices move along their heading, so the map is live.
// Signal: most phones on cellular or Wi-Fi; fleet-phone-09 and -12 lost their signal.
// Events (alerts endpoint): battery low on 03 and 06, a battery last call on 06, signal
// dropping then lost on 09 and 12, and a presence_offline alert on 12.

import { config } from "../config";
import { approximatePosition, offsetPosition } from "../lib/location";
import type {
  ActivityState,
  AlertRecord,
  AlertStatus,
  Device,
  DeviceAlerts,
  DeviceTelemetry,
  NetworkType,
  HealthSnapshot,
  PresenceState,
  TelemetryRecord,
} from "../types";

interface MockProfile {
  deviceId: string;
  secondsSinceUpdate: number;
  batteryLevel: number;
  isCharging: boolean;
  activityState: ActivityState;
  drainRatePerHour: number;
  /** Direction of travel in degrees (0 = north), for moving devices. */
  headingDeg?: number;
  /** No GPS fix yet: location is null. */
  noFix?: boolean;
  /** Latest signal reading: bars 0-4, dBm, network. */
  signal: [number, number | null, NetworkType];
  /** Type of the last "last call" event, if any. */
  lastCall?: "battery" | "connectivity";
}

const PROFILES: MockProfile[] = [
  { deviceId: "fleet-phone-01", secondsSinceUpdate: 3, batteryLevel: 78.5, isCharging: false, activityState: "walking", drainRatePerHour: 9.4, headingDeg: 274, signal: [4, -85, "cellular"] },
  { deviceId: "fleet-phone-02", secondsSinceUpdate: 4, batteryLevel: 34.0, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 14.8, headingDeg: 95, signal: [3, -95, "cellular"] },
  { deviceId: "fleet-phone-03", secondsSinceUpdate: 2, batteryLevel: 16.5, isCharging: false, activityState: "stationary", drainRatePerHour: 21.3, signal: [4, -55, "wifi"] },
  { deviceId: "fleet-phone-04", secondsSinceUpdate: 5, batteryLevel: 92.0, isCharging: false, activityState: "stationary", drainRatePerHour: 4.1, noFix: true, signal: [3, -67, "wifi"] },
  { deviceId: "fleet-phone-05", secondsSinceUpdate: 1, batteryLevel: 58.0, isCharging: false, activityState: "walking", drainRatePerHour: 8.2, headingDeg: 20, signal: [2, -103, "cellular"] },
  { deviceId: "fleet-phone-06", secondsSinceUpdate: 6, batteryLevel: 9.5, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 11.0, headingDeg: 200, signal: [2, -101, "cellular"], lastCall: "battery" },
  { deviceId: "fleet-phone-07", secondsSinceUpdate: 2, batteryLevel: 88.0, isCharging: true, activityState: "stationary", drainRatePerHour: 0, signal: [4, -50, "wifi"] },
  { deviceId: "fleet-phone-08", secondsSinceUpdate: 7, batteryLevel: 64.5, isCharging: false, activityState: "in_vehicle", drainRatePerHour: 7.5, headingDeg: 320, signal: [3, -92, "cellular"] },
  { deviceId: "fleet-phone-09", secondsSinceUpdate: 75, batteryLevel: 29.5, isCharging: false, activityState: "walking", drainRatePerHour: 10.2, headingDeg: 150, signal: [0, null, "none"], lastCall: "connectivity" },
  { deviceId: "fleet-phone-10", secondsSinceUpdate: 4, batteryLevel: 48.0, isCharging: false, activityState: "stationary", drainRatePerHour: 13.4, signal: [1, -108, "cellular"] },
  { deviceId: "fleet-phone-11", secondsSinceUpdate: 8, batteryLevel: 74.0, isCharging: false, activityState: "walking", drainRatePerHour: 6.8, headingDeg: 60, signal: [4, -83, "cellular"] },
  { deviceId: "fleet-phone-12", secondsSinceUpdate: 300, batteryLevel: 42.0, isCharging: false, activityState: "stationary", drainRatePerHour: 5.0, signal: [0, null, "none"], lastCall: "connectivity" },
];

const SAMPLE_INTERVAL_SECONDS = 10; // the phone sends a batch every 10 s
const CHARGE_RATE_PER_HOUR = 30; // how fast a charging mock device gains battery
const MAX_RECORDS = 500;
const SPEED_MPS: Record<ActivityState, number> = { stationary: 0, walking: 1.4, in_vehicle: 11 };
const ACCURACY_M: Record<ActivityState, number> = { stationary: 4, walking: 6.5, in_vehicle: 9 };
// Moving devices travel along their heading and start over every 10 minutes.
const ROUTE_LOOP_SECONDS = 600;

// Contract F defaults: SUSPECT after 60 s of silence, OFFLINE after 240 s.
function presenceOf(p: MockProfile): PresenceState {
  if (p.secondsSinceUpdate >= 240) return "OFFLINE";
  if (p.secondsSinceUpdate >= 60) return "SUSPECT";
  return "ONLINE";
}

/** Location, heading, travel status and presence fields added to Contract C. */
function liveFields(p: MockProfile, lastUpdated: string, now: number): Partial<Device> {
  const fixTime = now - p.secondsSinceUpdate * 1000;
  const speedMps = p.headingDeg === undefined ? 0 : SPEED_MPS[p.activityState];
  const [baseLat, baseLng] = approximatePosition(p.deviceId, config.mapCenter);
  // Silent devices stay where they were last seen.
  const travelled = presenceOf(p) === "ONLINE" ? speedMps * ((fixTime / 1000) % ROUTE_LOOP_SECONDS) : 0;
  const [lat, lon] = offsetPosition(baseLat, baseLng, travelled, p.headingDeg ?? 0);

  return {
    location: p.noFix
      ? null
      : {
          lat,
          lon,
          accuracyM: presenceOf(p) === "OFFLINE" ? 25 : ACCURACY_M[p.activityState],
          capturedAt: lastUpdated,
        },
    heading: p.headingDeg === undefined ? null : { degrees: p.headingDeg, speedMps },
    travelStatus: p.activityState,
    presenceState: presenceOf(p),
    lastSeenAt: new Date(fixTime + 1000).toISOString(), // server receipt, a second later
    signal: { level: p.signal[0], dbm: p.signal[1], networkType: p.signal[2] },
    // The last call was the final thing these devices sent (same time as the last snapshot).
    lastCallType: p.lastCall ?? null,
    lastCallAt: p.lastCall ? lastUpdated : null,
    lastKnownLocation: p.lastCall && !p.noFix
      ? { lat, lon, accuracyM: ACCURACY_M[p.activityState], capturedAt: lastUpdated }
      : null,
    lastKnownHeading: p.lastCall && p.headingDeg !== undefined ? { degrees: p.headingDeg, speedMps } : null,
  };
}

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
    return { deviceId: p.deviceId, lastUpdated: timestamp, ...health, ...liveFields(p, timestamp, now) };
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

/** [seconds ago, partial record] per device, newest first. Positions come from the device. */
type MockEvent = [number, Omit<AlertRecord, "timestamp" | "receivedAt">];

const EVENTS: Record<string, MockEvent[]> = {
  "fleet-phone-03": [
    [480, { alertType: "battery_low", alertStatus: "WARNING", alertReason: "Battery low", batteryLevel: 20, networkType: "wifi" }],
  ],
  "fleet-phone-06": [
    [70, { alertType: "battery_last_call", alertStatus: "CRITICAL", alertReason: "Battery last call", batteryLevel: 9.5, pendingEventCount: 0 }],
    [540, { alertType: "battery_low", alertStatus: "WARNING", alertReason: "Battery low", batteryLevel: 20 }],
  ],
  "fleet-phone-09": [
    [80, { alertType: "connectivity_last_call", alertStatus: "OK", alertReason: null, signalLevel: 0, previousSignalLevel: 1, signalDbm: -118, networkType: "none", batteryLevel: 30, pendingEventCount: 3 }],
    [150, { alertType: "connectivity_degraded", alertStatus: "OK", alertReason: null, signalLevel: 1, previousSignalLevel: 3, signalDbm: -109, previousSignalDbm: -88, windowSeconds: 60, networkType: "cellular", batteryLevel: 30, pendingEventCount: 0 }],
  ],
  "fleet-phone-10": [
    [240, { alertType: "connectivity_degraded", alertStatus: "OK", alertReason: null, signalLevel: 1, previousSignalLevel: 3, signalDbm: -108, previousSignalDbm: -86, windowSeconds: 60, networkType: "cellular", batteryLevel: 48, pendingEventCount: 0 }],
    [1500, { alertType: "presence_recovered", alertStatus: "OK", alertReason: "Back online", offlineAlertSentAt: new Date(Date.now() - 1920 * 1000).toISOString() }],
    [1920, { alertType: "presence_offline", alertStatus: "CRITICAL", alertReason: "Silent, cause unknown", silentSeconds: 251, lastCallType: null }],
  ],
  "fleet-phone-12": [
    [60, { alertType: "presence_offline", alertStatus: "CRITICAL", alertReason: "Silent after connectivity last call (signal lost)", silentSeconds: 270, lastCallType: "connectivity" }],
    [330, { alertType: "connectivity_last_call", alertStatus: "OK", alertReason: null, signalLevel: 0, previousSignalLevel: 2, signalDbm: -121, networkType: "none", batteryLevel: 42, pendingEventCount: 5 }],
    [400, { alertType: "connectivity_degraded", alertStatus: "OK", alertReason: null, signalLevel: 2, previousSignalLevel: 4, signalDbm: -104, networkType: "cellular", batteryLevel: 43, pendingEventCount: 0 }],
  ],
};

const LAST_CALLS = new Set(["battery_last_call", "connectivity_last_call"]);

export function getMockAlerts(deviceId: string, limit: number): DeviceAlerts {
  const device = getMockDevices().find((d) => d.deviceId === deviceId);
  const events = EVENTS[deviceId] ?? [];
  const now = Date.now();
  const records: AlertRecord[] = events.slice(0, Math.max(1, limit)).map(([ago, e]) => {
    const location = device?.location ?? null;
    return {
      ...e,
      timestamp: new Date(now - ago * 1000).toISOString(),
      receivedAt: new Date(now - ago * 1000 + 1500).toISOString(),
      travelStatus: device?.travelStatus ?? "unknown",
      heading: device?.heading ?? null,
      location,
      lastKnownLocation: LAST_CALLS.has(e.alertType) ? location : null,
    };
  });
  return { deviceId, records };
}
