// Display formatting for values from Contract C. The backend may omit a field,
// so every formatter accepts null/undefined and shows a dash instead.

import type { ActivityState, TravelStatus } from "../types";

const DASH = "—";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function formatPercent(n: number | null | undefined): string {
  return isNum(n) ? `${n.toFixed(1)}%` : DASH;
}

/** Drain rate shown as a negative change per hour, e.g. "-9.4%/hr". */
export function formatDrainRate(rate: number | null | undefined, isCharging?: boolean): string {
  if (isCharging) return "Charging";
  if (!isNum(rate) || rate <= 0) return "0.0%/hr";
  return `-${rate.toFixed(1)}%/hr`;
}

/** Minutes as "Xh Ym" (contract format). */
export function formatDuration(minutes: number | null | undefined, isCharging?: boolean): string {
  if (isCharging) return "Charging";
  if (!isNum(minutes)) return DASH;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm:ss UTC" (contract format). */
export function formatUtc(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return DASH;
  const d = new Date(t);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

/** "HH:mm:ss" in UTC, for chart axes and table rows. */
export function formatTimeUtc(iso: string | number | null | undefined): string {
  const t = typeof iso === "number" ? iso : iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return DASH;
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Relative age: "just now", "12s ago", "4m ago", "2h ago". */
export function formatAgo(timestampMs: number | null | undefined, now: number): string {
  if (!isNum(timestampMs)) return DASH;
  const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function parseTime(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

const ACTIVITY_LABELS: Record<TravelStatus, string> = {
  stationary: "Stationary",
  walking: "Walking",
  in_vehicle: "In Vehicle",
  unknown: "Unknown",
};

export function formatActivity(state: ActivityState | TravelStatus | null | undefined): string {
  return state ? (ACTIVITY_LABELS[state] ?? state) : DASH;
}

/** Meters per second as km/h, e.g. "40 km/h". */
export function formatSpeed(speedMps: number | null | undefined): string {
  return isNum(speedMps) ? `${Math.round(speedMps * 3.6)} km/h` : DASH;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Degrees with a compass point, e.g. "274° W". */
export function formatHeading(degrees: number | null | undefined): string {
  if (!isNum(degrees)) return DASH;
  const d = ((degrees % 360) + 360) % 360;
  return `${Math.round(d)}° ${COMPASS[Math.round(d / 45) % 8]}`;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
