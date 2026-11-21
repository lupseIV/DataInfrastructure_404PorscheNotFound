import { PATH_MINUTES, type DevicePathResult } from "../api";
import { formatSpeed, formatTimeUtc } from "../lib/format";
import { formatDistance } from "../lib/path";
import { formatSilence } from "../lib/signal";
import { Icon } from "./Icon";

interface DeviceRouteProps {
  route: DevicePathResult | null;
  loading: boolean;
  error: string | null;
  minutes: number;
  onMinutesChange: (minutes: number) => void;
  /** Frame the whole route on the map. */
  onFit: () => void;
}

/**
 * Route of the last N minutes (GET /api/devices/{id}/path): window presets, the summary the
 * backend computed, and a button to frame the route. The line itself is drawn by FleetMap.
 */
export function DeviceRoute({ route, loading, error, minutes, onMinutesChange, onFit }: DeviceRouteProps) {
  const points = route?.points ?? [];
  const summary = route?.summary;
  const gaps = points.filter((p) => p.gapBefore).length;

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1" role="group" aria-label="Route window">
        {PATH_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onMinutesChange(m)}
            aria-pressed={m === minutes}
            className={`flex-1 py-1 rounded text-[10px] font-mono border transition-colors ${
              m === minutes
                ? "bg-primary/15 border-primary/50 text-primary font-semibold"
                : "bg-surface-deep/60 border-line text-slate-400 hover:text-slate-200"
            }`}
          >
            {m}m
          </button>
        ))}
      </div>

      {error && !route ? (
        <p className="py-2 text-center text-[11px] font-mono text-red-400">Could not load the route: {error}</p>
      ) : !route ? (
        <p className="py-2 text-center text-[11px] font-mono text-slate-400">{loading ? "Loading route…" : "—"}</p>
      ) : !route.available ? (
        <p className="py-1 text-[11px] text-slate-400 flex items-start gap-1.5">
          <Icon name="info" className="text-[14px] mt-px shrink-0" />
          The backend doesn't provide routes yet (<span className="font-mono">GET /api/devices/&#123;id&#125;/path</span>).
          The route appears here as soon as it does.
        </p>
      ) : points.length === 0 ? (
        <p className="py-2 text-center text-[11px] font-mono text-slate-400">
          {route.to ? `No GPS fixes in the last ${minutes} minutes of data.` : "No history from this device yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <RouteStat label="Distance" value={formatDistance(summary?.distanceM)} />
            <RouteStat label="Duration" value={formatSilence(summary?.durationSeconds ?? 0)} />
            <RouteStat
              label="Max speed"
              value={summary?.maxSpeedMps === null || summary?.maxSpeedMps === undefined ? "—" : formatSpeed(summary.maxSpeedMps)}
            />
            <RouteStat
              label="Points"
              value={`${summary?.pointCount ?? points.length}${gaps > 0 ? ` · ${gaps} gap${gaps > 1 ? "s" : ""}` : ""}`}
            />
          </div>
          <p className="text-[10px] font-mono text-slate-400">
            {formatTimeUtc(points[0].timestamp)} → {formatTimeUtc(points[points.length - 1].timestamp)} UTC
            {route.to && Date.now() - Date.parse(route.to) > 5 * 60_000 ? " · before the device went silent" : ""}
          </p>
          <button
            type="button"
            onClick={onFit}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md bg-surface-container border border-line text-[11px] font-mono text-slate-200 hover:text-white hover:border-primary/50 transition-colors"
          >
            <Icon name="route" className="text-[15px] text-primary" />
            Show whole route
          </button>
        </>
      )}
    </div>
  );
}

function RouteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-mono text-slate-400">{label}</span>
      <span className="text-xs font-mono font-semibold text-slate-200 mt-0.5">{value}</span>
    </div>
  );
}
