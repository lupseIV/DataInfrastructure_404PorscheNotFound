import type { DeviceAlertsResult } from "../api";
import { formatAgo, formatTimeUtc, parseTime } from "../lib/format";
import { TONE_CLASSES, eventDetails, eventInfo, eventLocation } from "../lib/signal";
import type { DeviceLocation } from "../types";
import { Icon } from "./Icon";

interface DeviceEventsProps {
  alerts: DeviceAlertsResult | null;
  loading: boolean;
  error: string | null;
  now: number;
  /** Show a position on the map (an event's location or last known location). */
  onShowOnMap: (location: DeviceLocation, label: string) => void;
}

/**
 * Battery and connectivity events of one device (GET /api/devices/{id}/alerts), newest first.
 * Each row: what happened, when, the key numbers, and a button to show where it happened.
 */
export function DeviceEvents({ alerts, loading, error, now, onShowOnMap }: DeviceEventsProps) {
  if (error && !alerts) {
    return <p className="py-3 text-center text-[11px] font-mono text-red-400">Could not load events: {error}</p>;
  }
  if (!alerts) {
    return (
      <p className="py-3 text-center text-[11px] font-mono text-slate-400">
        {loading ? "Loading events…" : "—"}
      </p>
    );
  }
  if (!alerts.available) {
    return (
      <p className="py-2 text-[11px] text-slate-400 flex items-start gap-1.5">
        <Icon name="info" className="text-[14px] mt-px shrink-0" />
        The backend doesn't provide events yet (<span className="font-mono">GET /api/devices/&#123;id&#125;/alerts</span>).
        They appear here as soon as it does.
      </p>
    );
  }
  if (alerts.records.length === 0) {
    return <p className="py-3 text-center text-[11px] font-mono text-slate-400">No events in the last 7 days.</p>;
  }

  return (
    <ul className="space-y-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
      {alerts.records.map((record) => {
        const info = eventInfo(record.alertType);
        const tone = TONE_CLASSES[info.tone];
        const location = eventLocation(record);
        const details = eventDetails(record);
        const when = parseTime(record.timestamp);
        return (
          <li
            key={`${record.timestamp}#${record.alertType}`}
            className={`flex items-start gap-2 rounded-md bg-surface-deep/60 border border-line/60 border-l-2 ${tone.edge} px-2 py-1.5`}
          >
            <span className={`w-6 h-6 shrink-0 rounded flex items-center justify-center ${tone.icon}`}>
              <Icon name={info.icon} className="text-[15px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[11px] font-semibold ${tone.text}`}>{info.label}</span>
                <span
                  className="text-[10px] font-mono text-slate-400 shrink-0"
                  title={`${formatTimeUtc(record.timestamp)} UTC`}
                >
                  {formatAgo(when, now)}
                </span>
              </div>
              {details && <p className="text-[10px] font-mono text-slate-300 mt-0.5 break-words">{details}</p>}
              {location && (
                <button
                  type="button"
                  onClick={() => onShowOnMap(location, `${info.label} · ${formatTimeUtc(record.timestamp)} UTC`)}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-blue-400 hover:text-blue-300"
                >
                  <Icon name="location_on" className="text-[12px]" />
                  {record.lastKnownLocation || record.alertType === "presence_offline" ? "Show last known position" : "Show on map"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
