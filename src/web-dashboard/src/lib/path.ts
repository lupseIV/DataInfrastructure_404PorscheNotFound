// Turns the points of GET /api/devices/{deviceId}/path into lines to draw.
// The backend already picked the points and marked the gaps; this only groups them.

import type { PathPoint } from "../types";
import { signalColor } from "./signal";

/** A run of consecutive points drawn in one color. */
export interface PathRun {
  color: string;
  signalLevel: number | null;
  positions: [number, number][];
  from: string; // timestamp of the first point
  to: string; // timestamp of the last point
}

/** Points between two gaps: one continuous line. */
export interface PathSegment {
  positions: [number, number][];
  runs: PathRun[];
}

/**
 * Splits the path at every `gapBefore` (no line across an outage), then into runs of the
 * same signal color. Each run starts at the last point of the previous one, so the colored
 * pieces join without holes.
 */
export function toSegments(points: PathPoint[]): PathSegment[] {
  const segments: PathSegment[] = [];
  let current: PathSegment | null = null;
  let run: PathRun | null = null;

  for (const p of points) {
    const pos: [number, number] = [p.lat, p.lon];
    if (!current || p.gapBefore) {
      current = { positions: [], runs: [] };
      segments.push(current);
      run = null;
    }
    current.positions.push(pos);
    const color = signalColor(p.signalLevel);
    if (!run || run.color !== color) {
      const start: [number, number] | null = run ? run.positions[run.positions.length - 1] : null;
      run = { color, signalLevel: p.signalLevel, positions: start ? [start, pos] : [pos], from: p.timestamp, to: p.timestamp };
      current.runs.push(run);
    } else {
      run.positions.push(pos);
      run.to = p.timestamp;
    }
  }
  return segments;
}

/** "1.24 km", "380 m" */
export function formatDistance(meters: number | null | undefined): string {
  if (typeof meters !== "number" || !Number.isFinite(meters)) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

