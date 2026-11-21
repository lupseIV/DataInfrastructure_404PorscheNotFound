import { useEffect, useState } from "react";
import { STATUS_GROUPS, groupInfo, type StatusGroup } from "../lib/status";
import { Icon } from "./Icon";

interface StatusFilterBarProps {
  counts: Record<StatusGroup, number>;
  active: StatusGroup | null;
  onChange: (group: StatusGroup | null) => void;
}

const COLLAPSED_KEY = "fleetpulse.statusBarCollapsed";

/** Remembered per browser; falls back to expanded if storage is unavailable. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Summary cards above the map: one per battery group. Click to filter, click again to clear.
 * Can be hidden completely to give the map the full height; a small button over the map
 * brings it back. Must be rendered inside a `relative` container (the main area).
 */
export function StatusFilterBar({ counts, active, onChange }: StatusFilterBarProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Private mode or blocked storage: the choice just isn't remembered.
    }
  }, [collapsed]);

  if (collapsed) {
    const g = active ? groupInfo(active) : null;
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Show status cards"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface/90 backdrop-blur border border-line text-xs text-slate-200 hover:text-white shadow-lg"
        >
          <Icon name="expand_more" className="text-[16px] text-primary" />
          Status
        </button>
        {/* Keep an active filter visible, so a filtered map is never a surprise. */}
        {g && (
          <span
            className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border text-xs shadow-lg ${g.chipActive}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
            <span className="text-white">{g.label}</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Clear ${g.label} filter`}
              title="Clear filter"
              className="flex items-center rounded text-slate-300 hover:text-white"
            >
              <Icon name="close" className="text-[14px]" />
            </button>
          </span>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Battery status filter"
      className="px-3 py-2 border-b border-line/70 bg-surface/90 backdrop-blur z-10 shrink-0"
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {STATUS_GROUPS.map((g) => {
            const isActive = active === g.id;
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onChange(isActive ? null : g.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all text-left shrink-0 ${
                  isActive ? g.chipActive : `bg-surface-low hover:bg-[#1a243d] ${g.chipBorder}`
                } ${active && !isActive ? "opacity-60 hover:opacity-100" : ""}`}
              >
                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${g.iconBg}`}>
                  <Icon name={g.icon} className="text-[15px]" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 leading-none">
                    <span className={`text-xs font-bold font-mono ${g.text}`}>{counts[g.id]}</span>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wide ${
                        isActive ? "text-white" : "text-slate-300"
                      }`}
                    >
                      {g.label}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 block leading-tight mt-0.5">
                    {g.range}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={active === null}
          className="shrink-0 text-[11px] font-mono text-slate-400 hover:text-white px-2 py-1 rounded border border-transparent hover:border-line whitespace-nowrap disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:border-transparent disabled:cursor-default"
        >
          Clear Filter
        </button>

        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded={true}
          aria-label="Hide status cards"
          title="Hide status cards"
          className="shrink-0 flex items-center justify-center w-7 h-7 rounded border border-line text-slate-400 hover:text-white hover:bg-surface-container"
        >
          <Icon name="expand_less" className="text-[18px]" />
        </button>
      </div>
    </section>
  );
}
