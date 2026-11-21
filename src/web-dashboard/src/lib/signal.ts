// Display helpers for the network signal and the device events (alerts endpoint).
// Nothing here decides an alert: the phone and the backend do that; this only labels them.

import { parseTime } from "./format";
import type { AlertRecord, AlertType, Device, DeviceLocation, LastCallType, NetworkType } from "../types";

const NETWORK_LABELS: Record<NetworkType, string> = {
  wifi: "Wi-Fi",
  cellular: "Cellular",
  none: "No network",
};

export function formatNetwork(type: NetworkType | null | undefined): string {
  return type ? (NETWORK_LABELS[type] ?? type) : "—";
}

/** "Cellular · 3/4 bars · -92 dBm" */
export function formatSignal(
  level: number | null | undefined,
  networkType?: NetworkType | null,
  dbm?: number | null,
): string {
  const parts = [formatNetwork(networkType)];
  if (typeof level === "number") parts.push(`${level}/4 bars`);
  if (typeof dbm === "number" && Number.isFinite(dbm)) parts.push(`${Math.round(dbm)} dBm`);
  return parts.join(" · ");
}

export type EventTone = "critical" | "warning" | "info" | "ok";

export interface EventInfo {
  label: string;
  icon: string;
  tone: EventTone;
}

export const EVENT_INFO: Record<AlertType, EventInfo> = {
  battery_low: { label: "Battery low", icon: "battery_alert", tone: "warning" },
  battery_last_call: { label: "Battery last call", icon: "battery_0_bar", tone: "critical" },
  connectivity_degraded: { label: "Signal dropping", icon: "signal_cellular_alt_1_bar", tone: "info" },
  connectivity_last_call: { label: "Signal lost", icon: "signal_disconnected", tone: "warning" },
  presence_offline: { label: "Went offline", icon: "wifi_off", tone: "critical" },
  presence_recovered: { label: "Back online", icon: "wifi", tone: "ok" },
};

export const eventInfo = (type: AlertType): EventInfo =>
  EVENT_INFO[type] ?? { label: type, icon: "notifications", tone: "info" };

/** Tailwind classes per tone, written out in full so Tailwind can find them. */
export const TONE_CLASSES: Record<EventTone, { icon: string; text: string; edge: string }> = {
  critical: { icon: "bg-red-500/15 text-red-400", text: "text-red-400", edge: "border-l-red-500" },
  warning: { icon: "bg-amber-500/15 text-amber-400", text: "text-amber-400", edge: "border-l-amber-400" },
  info: { icon: "bg-blue-500/15 text-blue-400", text: "text-blue-400", edge: "border-l-blue-500" },
  ok: { icon: "bg-primary/15 text-primary", text: "text-primary", edge: "border-l-primary" },
};

/** Battery level of an event in percent (the API already converts the stored ratio). */
export function eventBatteryPercent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const LAST_CALL_LABELS: Record<LastCallType, string> = {
  battery: "Battery last call",
  connectivity: "Signal lost",
};

/**
 * The device's last call, only while it is still the final thing received (Contract F:
 * `lastCallAt >= lastEventTimestamp`). A last call followed by newer data is stale: the phone
 * kept working, so its last known position is no longer interesting.
 */
export function activeLastCall(device: Device): { type: LastCallType; location: DeviceLocation } | null {
  if (!device.lastCallType || !device.lastKnownLocation) return null;
  const callAt = parseTime(device.lastCallAt);
  const dataAt = parseTime(device.lastUpdated);
  if (callAt !== null && dataAt !== null && callAt < dataAt) return null;
  return { type: device.lastCallType, location: device.lastKnownLocation };
}

/** "4m 19s", "1h 05m" */
export function formatSilence(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Position to show for an event: the last known one for last calls, else the live one. */
export function eventLocation(record: AlertRecord): DeviceLocation | null {
  return record.lastKnownLocation ?? record.location ?? null;
}

/** One-line details of an event, e.g. "Signal 3 → 1 bars · -109 dBm · Cellular". */
export function eventDetails(record: AlertRecord): string {
  const parts: string[] = [];
  if (record.alertType === "presence_offline") {
    // alertReason holds the cause, e.g. "Silent after battery last call (likely battery dead)".
    if (record.alertReason) parts.push(record.alertReason);
    if (typeof record.silentSeconds === "number") parts.push(`silent ${formatSilence(record.silentSeconds)}`);
    return parts.join(" · ");
  }
  if (record.alertType === "presence_recovered") {
    const offlineAt = parseTime(record.offlineAlertSentAt);
    const backAt = parseTime(record.timestamp);
    if (offlineAt !== null && backAt !== null && backAt >= offlineAt) {
      parts.push(`Offline for ${formatSilence((backAt - offlineAt) / 1000)}`);
    }
    return parts.join(" · ");
  }
  if (typeof record.previousSignalLevel === "number" && typeof record.signalLevel === "number") {
    parts.push(`Signal ${record.previousSignalLevel} → ${record.signalLevel} bars`);
  } else if (typeof record.signalLevel === "number") {
    parts.push(`Signal ${record.signalLevel}/4 bars`);
  }
  if (typeof record.previousSignalDbm === "number" && typeof record.signalDbm === "number") {
    parts.push(`${Math.round(record.previousSignalDbm)} → ${Math.round(record.signalDbm)} dBm`);
  } else if (typeof record.signalDbm === "number") {
    parts.push(`${Math.round(record.signalDbm)} dBm`);
  }
  if (record.networkType) parts.push(formatNetwork(record.networkType));
  const battery = eventBatteryPercent(record.batteryLevel);
  if (battery !== null) parts.push(`Battery ${Math.round(battery)}%`);
  if (record.pendingEventCount) parts.push(`${record.pendingEventCount} unsent`);
  if (parts.length === 0 && record.alertReason) parts.push(record.alertReason);
  return parts.join(" · ");
}

/** Color of a signal level 0..4 (red: none, amber: weak, green: good). */
export const SIGNAL_COLORS = ["#ef4444", "#f59e0b", "#f59e0b", "#10b981", "#10b981"] as const;
/** Route color where the phone sent no signal reading (e.g. iOS). */
export const NO_SIGNAL_DATA_COLOR = "#60a5fa";

export function signalColor(level: number | null | undefined): string {
  if (typeof level !== "number" || !Number.isFinite(level)) return NO_SIGNAL_DATA_COLOR;
  return SIGNAL_COLORS[Math.max(0, Math.min(4, Math.round(level)))];
}
