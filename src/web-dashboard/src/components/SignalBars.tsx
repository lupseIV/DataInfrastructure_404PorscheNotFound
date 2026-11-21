import { formatSignal } from "../lib/signal";
import type { NetworkType } from "../types";

interface SignalBarsProps {
  level: number | null | undefined; // 0-4
  networkType?: NetworkType | null;
  dbm?: number | null;
  /** Bar height in px of the tallest bar. */
  size?: number;
}

const COLORS = ["#ef4444", "#f59e0b", "#f59e0b", "#10b981", "#10b981"]; // by level 0..4

/** Four ascending bars, filled up to `level`, colored by strength. Tooltip has the details. */
export function SignalBars({ level, networkType, dbm, size = 12 }: SignalBarsProps) {
  if (typeof level !== "number") return null;
  const lv = Math.max(0, Math.min(4, Math.round(level)));
  const color = COLORS[lv];
  const label = formatSignal(lv, networkType, dbm);
  const width = 3;
  const gap = 1.5;

  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-end shrink-0" style={{ height: size }}>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className="rounded-[1px]"
          style={{
            width,
            marginLeft: bar === 1 ? 0 : gap,
            height: Math.round((size * bar) / 4),
            background: bar <= lv ? color : "rgba(148, 163, 184, 0.25)",
          }}
        />
      ))}
    </span>
  );
}
