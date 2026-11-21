import { formatActivity, formatPercent, formatTimeUtc } from "../lib/format";
import { alertStyle } from "../lib/status";
import type { ActivityState, TelemetryRecord } from "../types";
import { Icon } from "./Icon";

const ACTIVITY_ICONS: Record<ActivityState, string> = {
  stationary: "pin_drop",
  walking: "directions_walk",
  in_vehicle: "local_shipping",
};

const SHORT_ALERT = { OK: "OK", WARNING: "WARN", CRITICAL: "CRIT" } as const;

/** Recent snapshots, newest first (as returned by the API). */
export function HistoryTable({ records }: { records: TelemetryRecord[] }) {
  if (records.length === 0) {
    return <p className="py-4 text-center text-[11px] font-mono text-slate-400">No events stored yet.</p>;
  }

  return (
    <div className="max-h-64 overflow-y-auto -mx-1">
      <table className="w-full text-[10px] font-mono">
        <thead className="sticky top-0 bg-surface-panel">
          <tr className="text-left text-slate-400 uppercase tracking-wider">
            <th className="px-1 py-1.5 font-semibold">Time</th>
            <th className="px-1 py-1.5 font-semibold text-right">Batt</th>
            <th className="px-1 py-1.5 font-semibold text-center">Chg</th>
            <th className="px-1 py-1.5 font-semibold text-center">Act</th>
            <th className="px-1 py-1.5 font-semibold text-right">Drain</th>
            <th className="px-1 py-1.5 font-semibold text-right">Alert</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const alert = alertStyle(r.alertStatus);
            return (
              <tr key={r.timestamp} className="border-t border-line/60 text-slate-300">
                <td className="px-1 py-1">{formatTimeUtc(r.timestamp)}</td>
                <td className="px-1 py-1 text-right">{formatPercent(r.batteryLevel)}</td>
                <td className="px-1 py-1 text-center">
                  {r.isCharging ? (
                    <Icon name="bolt" className="text-[12px] text-cyan-400 align-middle" />
                  ) : (
                    <span className="text-slate-600">–</span>
                  )}
                </td>
                <td className="px-1 py-1 text-center" title={formatActivity(r.activityState)}>
                  <Icon
                    name={ACTIVITY_ICONS[r.activityState] ?? "help"}
                    className="text-[12px] text-slate-400 align-middle"
                  />
                </td>
                <td className="px-1 py-1 text-right">
                  {typeof r.drainRatePerHour === "number" ? r.drainRatePerHour.toFixed(1) : "—"}
                </td>
                <td
                  className={`px-1 py-1 text-right font-semibold ${alert.text}`}
                  title={r.alertReason ?? undefined}
                >
                  {SHORT_ALERT[r.alertStatus] ?? r.alertStatus}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
