// Battery status groups used by the summary cards, the device list and the map colors.
// This is display grouping only; alerts (OK / WARNING / CRITICAL) come from the backend.
//
// A device belongs to the first group that matches, in this order:
//   offline  -> the server says OFFLINE (presenceState, Contract F); if the backend
//               doesn't send presenceState, no data for staleAfterMs (30 s) or more
//   charging -> plugged in
//   critical -> battery < 20 %
//   low      -> 20 % to < 40 %
//   medium   -> 40 % to < 70 %
//   high     -> 70 % and above
// The 20 % and 40 % limits match the backend's alert rules.

import type { AlertStatus, Device } from "../types";

export type StatusGroup = "critical" | "low" | "medium" | "high" | "charging" | "offline";

export interface StatusGroupInfo {
  id: StatusGroup;
  label: string;
  shortLabel: string;
  range: string;
  icon: string;
  /** Hex color for the map markers and chart. */
  color: string;
  // Tailwind classes, written out in full so Tailwind can find them.
  text: string;
  dot: string;
  bar: string;
  chipBorder: string;
  chipActive: string;
  iconBg: string;
}

/** Display order of the summary cards and legend. */
export const STATUS_GROUPS: StatusGroupInfo[] = [
  {
    id: "critical", label: "Critical", shortLabel: "Crit", range: "<20% Battery", icon: "warning",
    color: "#ef4444", text: "text-red-400", dot: "bg-red-500", bar: "bg-red-500",
    chipBorder: "border-red-500/30", chipActive: "bg-red-500/15 border-red-500 ring-1 ring-red-500/40", iconBg: "bg-red-500/15 text-red-400",
  },
  {
    id: "low", label: "Low", shortLabel: "Low", range: "20–40%", icon: "battery_alert",
    color: "#f59e0b", text: "text-amber-400", dot: "bg-amber-400", bar: "bg-amber-400",
    chipBorder: "border-amber-500/30", chipActive: "bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/40", iconBg: "bg-amber-500/15 text-amber-400",
  },
  {
    id: "medium", label: "Medium", shortLabel: "Med", range: "40–70%", icon: "battery_4_bar",
    color: "#3b82f6", text: "text-blue-400", dot: "bg-blue-500", bar: "bg-blue-500",
    chipBorder: "border-blue-500/30", chipActive: "bg-blue-500/15 border-blue-500 ring-1 ring-blue-500/40", iconBg: "bg-blue-500/15 text-blue-400",
  },
  {
    id: "high", label: "High", shortLabel: "High", range: "≥70% Battery", icon: "battery_full",
    color: "#10b981", text: "text-primary", dot: "bg-primary", bar: "bg-primary",
    chipBorder: "border-primary/30", chipActive: "bg-primary/15 border-primary ring-1 ring-primary/40", iconBg: "bg-primary/15 text-primary",
  },
  {
    id: "charging", label: "Charging", shortLabel: "Chg", range: "Plugged In", icon: "bolt",
    color: "#22d3ee", text: "text-cyan-400", dot: "bg-cyan-400", bar: "bg-cyan-400",
    chipBorder: "border-cyan-500/30", chipActive: "bg-cyan-500/15 border-cyan-400 ring-1 ring-cyan-400/40", iconBg: "bg-cyan-500/15 text-cyan-400",
  },
  {
    id: "offline", label: "Offline", shortLabel: "Offline", range: "Not reporting", icon: "wifi_off",
    color: "#64748b", text: "text-slate-400", dot: "bg-slate-500", bar: "bg-slate-600",
    chipBorder: "border-slate-600/40", chipActive: "bg-slate-500/15 border-slate-400 ring-1 ring-slate-400/40", iconBg: "bg-slate-700/30 text-slate-400",
  },
];

const BY_ID = Object.fromEntries(STATUS_GROUPS.map((g) => [g.id, g])) as Record<
  StatusGroup,
  StatusGroupInfo
>;

export const groupInfo = (id: StatusGroup): StatusGroupInfo => BY_ID[id];

/** True when the time is `staleAfterMs` or more in the past (or unreadable). */
export function isStale(timestamp: string | null | undefined, now: number, staleAfterMs: number) {
  const t = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isNaN(t) || now - t >= staleAfterMs;
}

/**
 * When the server last heard from the device: `lastSeenAt` (server clock) when the
 * backend sends it, otherwise the device's `lastUpdated`.
 */
export function lastSeenOf(device: Device): string {
  return device.lastSeenAt ?? device.lastUpdated;
}

/**
 * Offline means the server's presence check says OFFLINE (it waits a grace period,
 * 4 minutes by default). Older backends without `presenceState` fall back to
 * "no data for staleAfterMs".
 */
export function isOffline(device: Device, now: number, staleAfterMs: number): boolean {
  if (device.presenceState) return device.presenceState === "OFFLINE";
  return isStale(lastSeenOf(device), now, staleAfterMs);
}

/** Silent for over a minute but not yet OFFLINE (server presence only). */
export const isSuspect = (device: Device) => device.presenceState === "SUSPECT";

export function getStatusGroup(device: Device, now: number, staleAfterMs: number): StatusGroup {
  if (isOffline(device, now, staleAfterMs)) return "offline";
  if (device.isCharging) return "charging";
  const level = typeof device.batteryLevel === "number" ? device.batteryLevel : 0;
  if (level < 20) return "critical";
  if (level < 40) return "low";
  if (level < 70) return "medium";
  return "high";
}

export function countByGroup(groups: StatusGroup[]): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = {
    critical: 0, low: 0, medium: 0, high: 0, charging: 0, offline: 0,
  };
  for (const g of groups) counts[g] += 1;
  return counts;
}

/** Colors for the backend's alert status (banner, table, badges). */
export const ALERT_STYLES: Record<
  AlertStatus,
  { label: string; icon: string; banner: string; text: string; badge: string }
> = {
  OK: {
    label: "OK",
    icon: "check_circle",
    banner: "bg-primary/10 border-primary/40 text-primary",
    text: "text-primary",
    badge: "bg-primary/15 border-primary/40 text-primary",
  },
  WARNING: {
    label: "Warning",
    icon: "warning",
    banner: "bg-amber-500/10 border-amber-500/40 text-amber-300",
    text: "text-amber-400",
    badge: "bg-amber-500/15 border-amber-500/40 text-amber-400",
  },
  CRITICAL: {
    label: "Critical",
    icon: "error",
    banner: "bg-red-500/10 border-red-500/40 text-red-300",
    text: "text-red-400",
    badge: "bg-red-500/15 border-red-500/40 text-red-400",
  },
};

export const alertStyle = (status: AlertStatus | null | undefined) =>
  ALERT_STYLES[status ?? "OK"] ?? ALERT_STYLES.OK;
