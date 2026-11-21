// Display helpers for the network signal and the device events (alerts endpoint).
// Nothing here decides an alert: the phone and the backend do that; this only labels them.

import type { AlertRecord, AlertType, DeviceLocation, NetworkType } from "../types";

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

/**
 * Battery level of an event as a percent. The contract's example shows a percent (9.0) while
 * stored events hold the phone's 0–1 ratio, so values ≤ 1 are treated as a ratio.
 */
export function eventBatteryPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

/** Position to show for an event: the last known one for last calls, else the live one. */
export function eventLocation(record: AlertRecord): DeviceLocation | null {
  return record.lastKnownLocation ?? record.location ?? null;
}

/** One-line details of an event, e.g. "Signal 3 → 1 bars · -109 dBm · Cellular". */
export function eventDetails(record: AlertRecord): string {
  const parts: string[] = [];
  if (typeof record.previousSignalLevel === "number" && typeof record.signalLevel === "number") {
    parts.push(`Signal ${record.previousSignalLevel} → ${record.signalLevel} bars`);
  } else if (typeof record.signalLevel === "number") {
    parts.push(`Signal ${record.signalLevel}/4 bars`);
  }
  if (typeof record.signalDbm === "number") parts.push(`${Math.round(record.signalDbm)} dBm`);
  if (record.networkType) parts.push(formatNetwork(record.networkType));
  const battery = eventBatteryPercent(record.batteryLevel);
  if (battery !== null) parts.push(`Battery ${Math.round(battery)}%`);
  if (record.pendingEventCount) parts.push(`${record.pendingEventCount} unsent`);
  if (parts.length === 0 && record.alertReason) parts.push(record.alertReason);
  return parts.join(" · ");
}
