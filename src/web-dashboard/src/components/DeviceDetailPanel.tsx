import type { ReactNode } from "react";
import {
  formatActivity,
  formatAgo,
  formatCoordinates,
  formatDrainRate,
  formatDuration,
  formatHeading,
  formatPercent,
  formatSpeed,
  formatUtc,
  parseTime,
} from "../lib/format";
import type { DeviceAlertsResult } from "../api";
import { hasGpsFix } from "../lib/location";
import { LAST_CALL_LABELS, activeLastCall, formatSignal } from "../lib/signal";
import { alertStyle, groupInfo, isSuspect, lastSeenOf, type StatusGroup } from "../lib/status";
import type { Device, DeviceLocation, TelemetryRecord } from "../types";
import { BatteryChart } from "./BatteryChart";
import { DeviceEvents } from "./DeviceEvents";
import { HistoryTable } from "./HistoryTable";
import { Icon } from "./Icon";
import { SignalBars } from "./SignalBars";

interface DeviceDetailPanelProps {
  device: Device;
  group: StatusGroup;
  now: number;
  history: TelemetryRecord[] | null;
  historyLoading: boolean;
  historyError: string | null;
  alerts: DeviceAlertsResult | null;
  alertsLoading: boolean;
  alertsError: string | null;
  /** Show a position on the map (event location or last known location). */
  onShowOnMap: (location: DeviceLocation, label: string) => void;
  onClose: () => void;
}

/** Right-hand inspector for the selected device (bottom sheet on mobile). */
export function DeviceDetailPanel({
  device,
  group,
  now,
  history,
  historyLoading,
  historyError,
  alerts,
  alertsLoading,
  alertsError,
  onShowOnMap,
  onClose,
}: DeviceDetailPanelProps) {
  const g = groupInfo(group);
  const alert = alertStyle(device.alertStatus);
  const offline = group === "offline";
  const suspect = isSuspect(device);
  const lastSeen = formatAgo(parseTime(lastSeenOf(device)), now);
  const loc = hasGpsFix(device) ? device.location! : null;
  const heading = device.heading ?? null;
  const signal = device.signal ?? null;
  // Shown only while the last call is still the final thing the phone sent.
  const lastCall = activeLastCall(device);
  const lastKnown = lastCall?.location ?? null;
  const lastCallLabel = lastCall ? LAST_CALL_LABELS[lastCall.type] : "Last call";
  const connection = offline
    ? { text: "Offline", cls: "text-slate-400" }
    : suspect
      ? { text: "No data for >1 min", cls: "text-amber-400" }
      : { text: "Online", cls: "text-primary" };
  const level = Math.min(100, Math.max(0, device.batteryLevel ?? 0));
  const drain = device.drainRatePerHour ?? 0;
  const drainColor = device.isCharging
    ? "text-cyan-400"
    : drain > 25
      ? "text-red-400"
      : drain > 12
        ? "text-amber-400"
        : "text-primary-light";

  return (
    <aside
      aria-label={`Details for ${device.deviceId}`}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] rounded-t-xl border-t border-line shadow-[0_-8px_24px_rgba(0,0,0,0.45)]
        lg:static lg:z-20 lg:max-h-none lg:w-[320px] lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none
        h-auto lg:h-full shrink-0 flex flex-col bg-surface-panel border-line/70 overflow-hidden"
    >
      {/* Header */}
      <div className="p-3 border-b border-line/70 bg-surface/80 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${g.iconBg}`}>
            <Icon name="smartphone" className="text-[18px]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-mono text-xs font-bold text-white tracking-tight leading-none truncate">
                {device.deviceId}
              </h2>
              <span
                className={`px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold leading-none ${g.iconBg} ${g.chipBorder}`}
              >
                {g.label}
              </span>
            </div>
            <span className={`text-[10px] font-mono leading-none block mt-1 ${connection.cls}`}>
              {offline || suspect
                ? `${connection.text} · last seen ${lastSeen}`
                : `Online · last ping ${lastSeen}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close details"
          aria-label="Close details"
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-container"
        >
          {/* Wrapped: Google's icon stylesheet sets `display` on the icon itself. */}
          <span className="hidden lg:flex">
            <Icon name="keyboard_double_arrow_right" className="text-[18px]" />
          </span>
          <span className="flex lg:hidden">
            <Icon name="close" className="text-[18px]" />
          </span>
        </button>
      </div>

      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {/* Alert from the backend */}
        <div className={`rounded-lg border px-3 py-2 flex items-start gap-2 ${alert.banner}`}>
          <Icon name={alert.icon} className="text-[18px] mt-px" />
          <div className="min-w-0">
            <div className="text-[11px] font-mono font-bold uppercase tracking-wider">{alert.label}</div>
            <div className="text-xs text-slate-200 mt-0.5">{device.alertReason ?? "No active alerts."}</div>
          </div>
        </div>

        {/* Battery */}
        <Card icon="battery_charging_full" iconClass="text-primary" title="Battery Health" badge={g.label} badgeClass={g.text}>
          <div className="flex items-baseline justify-between pt-0.5">
            <span className="text-2xl font-bold font-mono text-white tracking-tight">
              {formatPercent(device.batteryLevel)}
            </span>
            <span className={`text-xs font-mono font-medium ${drainColor}`}>
              {formatDrainRate(device.drainRatePerHour, device.isCharging)}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-surface-deep overflow-hidden">
            <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${level}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-line/50">
            <Stat label="Time remaining" value={formatDuration(device.estimatedMinutesRemaining, device.isCharging)} />
            <Stat label="Power" value={device.isCharging ? "Charging" : "On Battery"} />
          </div>
        </Card>

        {/* Activity & status */}
        <Card icon="sensors" iconClass="text-amber-400" title="Activity & Status">
          <div className="space-y-0 text-xs font-mono">
            <Row label="Motion state" value={formatActivity(device.travelStatus ?? device.activityState)} />
            {heading && (
              <Row label="Speed / heading" value={`${formatSpeed(heading.speedMps)} · ${formatHeading(heading.degrees)}`} />
            )}
            <Row label="Connection" value={connection.text} valueClass={connection.cls} />
            {signal && (
              <div className="flex items-center justify-between gap-2 py-1.5 border-b border-line/40">
                <span className="text-slate-400 text-[11px]">Network</span>
                <span className="flex items-center gap-2 font-medium text-[11px] text-slate-200 text-right">
                  <SignalBars level={signal.level} networkType={signal.networkType} dbm={signal.dbm} />
                  {formatSignal(signal.level, signal.networkType, signal.dbm)}
                </span>
              </div>
            )}
            <Row label="Last seen" value={formatUtc(lastSeenOf(device))} last />
          </div>
        </Card>

        {/* Location */}
        <Card icon="location_on" iconClass="text-blue-400" title="Location" badge={loc ? "GPS" : "Approximate"} badgeClass={loc ? "text-primary" : "text-amber-400"}>
          {loc ? (
            <>
              <div className="space-y-0 text-xs font-mono">
                <Row label="Coordinates" value={formatCoordinates(loc.lat, loc.lon)} />
                <Row label="Accuracy" value={typeof loc.accuracyM === "number" ? `±${loc.accuracyM.toFixed(1)} m` : "—"} />
                <Row label="Fix taken" value={formatAgo(parseTime(loc.capturedAt), now)} last />
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md border border-line bg-surface-container hover:bg-surface-high text-[11px] font-mono text-slate-200"
              >
                <Icon name="directions" className="text-[15px] text-blue-400" />
                Open in Google Maps
              </a>
            </>
          ) : (
            <p className="text-[11px] text-slate-400">
              No GPS fix from this device yet. Its position on the map is approximate.
            </p>
          )}
          {lastKnown && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                <Icon name="share_location" className="text-[14px]" />
                Last known position · {lastCallLabel}
              </div>
              <div className="mt-0.5 text-[10px] font-mono text-slate-300">
                {formatCoordinates(lastKnown.lat, lastKnown.lon)} · {formatAgo(parseTime(lastKnown.capturedAt), now)}
              </div>
              <button
                type="button"
                onClick={() => onShowOnMap(lastKnown, `Last known position · ${lastCallLabel}`)}
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-blue-400 hover:text-blue-300"
              >
                <Icon name="location_on" className="text-[12px]" />
                Show on map
              </button>
            </div>
          )}
        </Card>

        {/* Events from the alerts endpoint */}
        <Card
          icon="notifications"
          iconClass="text-red-400"
          title="Device Events"
          badge={alerts?.available && alerts.records.length > 0 ? `${alerts.records.length}` : undefined}
          badgeClass="text-slate-400"
        >
          <DeviceEvents
            alerts={alerts}
            loading={alertsLoading}
            error={alertsError}
            now={now}
            onShowOnMap={onShowOnMap}
          />
        </Card>

        {/* History */}
        <Card icon="monitoring" iconClass="text-cyan-400" title="Battery History">
          {historyError && !history ? (
            <p className="py-4 text-center text-[11px] font-mono text-red-400">Could not load history: {historyError}</p>
          ) : historyLoading && !history ? (
            <p className="py-6 text-center text-[11px] font-mono text-slate-400">Loading history…</p>
          ) : (
            <BatteryChart records={history ?? []} />
          )}
        </Card>

        <Card icon="receipt_long" iconClass="text-slate-300" title="Recent Events" badge={history ? `${history.length}` : undefined} badgeClass="text-slate-400">
          {history ? (
            <HistoryTable records={history} />
          ) : (
            <p className="py-4 text-center text-[11px] font-mono text-slate-400">
              {historyError ? "Unavailable." : "Loading…"}
            </p>
          )}
        </Card>
      </div>
    </aside>
  );
}

function Card({
  icon,
  iconClass,
  title,
  badge,
  badgeClass = "",
  children,
}: {
  icon: string;
  iconClass: string;
  title: string;
  badge?: string;
  badgeClass?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-surface-low/60 border border-line p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Icon name={icon} className={`text-[15px] ${iconClass}`} />
          <h3 className="text-xs font-semibold">{title}</h3>
        </div>
        {badge && (
          <span className={`text-[10px] font-mono bg-white/5 px-1.5 py-0.5 rounded ${badgeClass}`}>{badge}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-mono text-slate-400">{label}</span>
      <span className="text-xs font-mono font-semibold text-slate-200 mt-0.5">{value}</span>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "text-slate-200",
  last = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 py-1.5 ${last ? "" : "border-b border-line/40"}`}>
      <span className="text-slate-400 text-[11px]">{label}</span>
      <span className={`font-medium text-[11px] text-right ${valueClass}`}>{value}</span>
    </div>
  );
}
