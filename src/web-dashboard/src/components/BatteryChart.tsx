import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTimeUtc } from "../lib/format";
import type { TelemetryRecord } from "../types";

const BATTERY_COLOR = "#4edea3";
const DRAIN_COLOR = "#ffb95f";

interface ChartPoint {
  t: number;
  battery: number | null;
  drain: number | null;
}

/** Battery % (left axis) and drain rate %/hr (right axis) over time. */
export function BatteryChart({ records }: { records: TelemetryRecord[] }) {
  // The API returns newest first; the chart needs oldest first.
  const data: ChartPoint[] = records
    .map((r) => ({
      t: Date.parse(r.timestamp),
      battery: typeof r.batteryLevel === "number" ? r.batteryLevel : null,
      drain: typeof r.drainRatePerHour === "number" ? r.drainRatePerHour : null,
    }))
    .filter((p) => !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);

  if (data.length < 2) {
    return <p className="py-6 text-center text-[11px] font-mono text-slate-400">Not enough history yet.</p>;
  }

  return (
    <div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => formatTimeUtc(t).slice(0, 5)}
              tick={{ fill: "#64748b", fontSize: 9, fontFamily: "JetBrains Mono" }}
              stroke="#1e293b"
              minTickGap={24}
            />
            <YAxis
              yAxisId="battery"
              domain={[0, 100]}
              tick={{ fill: "#64748b", fontSize: 9, fontFamily: "JetBrains Mono" }}
              stroke="#1e293b"
              width={40}
            />
            <YAxis
              yAxisId="drain"
              orientation="right"
              domain={[0, "auto"]}
              tick={{ fill: "#64748b", fontSize: 9, fontFamily: "JetBrains Mono" }}
              stroke="#1e293b"
              width={28}
            />
            <Tooltip
              contentStyle={{
                background: "#0b1326",
                border: "1px solid #334155",
                borderRadius: 4,
                fontFamily: "JetBrains Mono",
                fontSize: 11,
              }}
              labelStyle={{ color: "#94a3b8" }}
              labelFormatter={(t) => `${formatTimeUtc(Number(t))} UTC`}
              formatter={(value, name) =>
                name === "battery"
                  ? [`${Number(value).toFixed(1)}%`, "Battery"]
                  : [`${Number(value).toFixed(1)}%/hr`, "Drain"]
              }
            />
            <Line
              yAxisId="battery"
              type="monotone"
              dataKey="battery"
              stroke={BATTERY_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="drain"
              type="monotone"
              dataKey="drain"
              stroke={DRAIN_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1.5 flex items-center gap-4 text-[10px] font-mono text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ background: BATTERY_COLOR }} /> Battery %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ background: DRAIN_COLOR }} /> Drain %/hr
        </span>
        <span className="ml-auto">UTC</span>
      </div>
    </div>
  );
}
