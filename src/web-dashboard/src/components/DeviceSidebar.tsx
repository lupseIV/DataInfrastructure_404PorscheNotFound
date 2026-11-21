import { formatPercent } from "../lib/format";
import { groupInfo, type StatusGroup } from "../lib/status";
import type { Device } from "../types";
import { Icon } from "./Icon";

export interface DeviceRow {
  device: Device;
  group: StatusGroup;
}

interface DeviceSidebarProps {
  rows: DeviceRow[];
  totalCount: number;
  filterLabel: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  loading: boolean;
  /** The device list could not be loaded and there is no older data to show. */
  loadFailed: boolean;
  /** Desktop: panel folded away. */
  collapsed: boolean;
  onCollapse: () => void;
  /** Mobile: drawer open. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function DeviceSidebar({
  rows,
  totalCount,
  filterLabel,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  loading,
  loadFailed,
  collapsed,
  onCollapse,
  mobileOpen,
  onCloseMobile,
}: DeviceSidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 top-16 z-30 bg-black/50 lg:hidden" onClick={onCloseMobile} />
      )}

      <aside
        aria-label="Devices"
        className={`fixed top-16 bottom-0 left-0 z-40 w-[280px] max-w-[85vw] flex flex-col border-r border-line/70 bg-surface-panel transition-transform duration-200
          lg:static lg:z-20 lg:w-[240px] lg:translate-x-0 lg:transition-none
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          ${collapsed ? "lg:hidden" : "lg:flex"}`}
      >
        {/* Header & search */}
        <div className="p-2.5 border-b border-line/60 flex flex-col gap-2 bg-surface/60">
          <div className="flex items-center justify-between pb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white tracking-tight">Devices</span>
              <span className="px-1.5 py-0.5 rounded-full bg-surface-low border border-line text-[10px] font-mono text-primary">
                {totalCount}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-slate-400">{filterLabel ?? "All Systems"}</span>
              <button
                type="button"
                onClick={onCollapse}
                title="Fold device list"
                aria-label="Fold device list"
                className="hidden lg:flex p-0.5 rounded text-slate-400 hover:text-white hover:bg-surface-container"
              >
                <Icon name="keyboard_double_arrow_left" className="text-[16px]" />
              </button>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close device list"
                className="lg:hidden p-0.5 rounded text-slate-400 hover:text-white"
              >
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search devices..."
              aria-label="Search devices"
              className="w-full bg-surface-deep border border-line rounded py-1 pl-7 pr-6 text-[11px] font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
          {loading && rows.length === 0 && (
            <p className="p-3 text-[11px] font-mono text-slate-400">Loading devices…</p>
          )}

          {!loading && rows.length === 0 && (
            <p className="p-3 text-[11px] font-mono text-slate-400">
              {loadFailed
                ? "Could not load devices."
                : totalCount === 0
                  ? "No devices have reported yet."
                  : "No devices match this filter."}
            </p>
          )}

          {rows.map(({ device, group }) => {
            const g = groupInfo(group);
            const selected = device.deviceId === selectedId;
            const offline = group === "offline";
            const level = Math.min(100, Math.max(0, device.batteryLevel ?? 0));

            return (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => onSelect(device.deviceId)}
                aria-current={selected}
                className={`w-full p-2 rounded border text-left transition-all flex flex-col gap-1 ${
                  selected
                    ? "border-primary bg-primary/15 ring-1 ring-primary/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                    : "border-transparent bg-surface-low/60 hover:bg-surface-container"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${g.dot}`}
                      style={offline ? undefined : { boxShadow: `0 0 8px ${g.color}` }}
                    />
                    <span
                      className={`font-mono text-[11px] truncate ${
                        selected ? "font-bold text-white" : offline ? "font-medium text-slate-400" : "font-medium text-slate-300"
                      }`}
                    >
                      {device.deviceId}
                    </span>
                  </div>
                  {offline ? (
                    <span className="font-mono text-[11px] font-bold text-slate-400">Offline</span>
                  ) : (
                    <span className={`flex items-center gap-0.5 font-mono text-[11px] font-bold ${g.text}`}>
                      {device.isCharging && <Icon name="bolt" className="text-[13px]" />}
                      {formatPercent(device.batteryLevel)}
                    </span>
                  )}
                </div>
                <div className="w-full h-1 rounded-full bg-surface-deep overflow-hidden">
                  <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${level}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
