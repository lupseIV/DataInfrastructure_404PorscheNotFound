import { STATUS_GROUPS, type StatusGroup } from "../lib/status";
import { Icon } from "./Icon";

interface StatusFilterBarProps {
  counts: Record<StatusGroup, number>;
  active: StatusGroup | null;
  onChange: (group: StatusGroup | null) => void;
}

/** Summary cards above the map: one per battery group. Click to filter, click again to clear. */
export function StatusFilterBar({ counts, active, onChange }: StatusFilterBarProps) {
  return (
    <section className="px-3 py-2 border-b border-line/70 bg-surface/90 backdrop-blur z-10 shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
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

        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={active === null}
          className="ml-auto text-[11px] font-mono text-slate-400 hover:text-white px-2 py-1 rounded border border-transparent hover:border-line whitespace-nowrap disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:border-transparent disabled:cursor-default"
        >
          Clear Filter
        </button>
      </div>
    </section>
  );
}
