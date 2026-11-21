import { formatAgo } from "../lib/format";
import { Icon } from "./Icon";

interface TopBarProps {
  onlineCount: number;
  /** When the device list was last fetched successfully (ms), or null before the first load. */
  lastUpdatedAt: number | null;
  now: number;
  isMock: boolean;
  hasError: boolean;
  onRefresh: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({
  onlineCount,
  lastUpdatedAt,
  now,
  isMock,
  hasError,
  onRefresh,
  onToggleSidebar,
}: TopBarProps) {
  const updatedText = lastUpdatedAt === null ? "Connecting…" : `Updated ${formatAgo(lastUpdatedAt, now)}`;

  return (
    <header className="h-16 w-full px-3 lg:px-6 bg-surface/95 backdrop-blur border-b border-line/70 flex items-center justify-between gap-3 shrink-0 z-30">
      <div className="flex items-center gap-3 lg:gap-5 min-w-0">
        <button
          type="button"
          aria-label="Toggle device list"
          onClick={onToggleSidebar}
          className="lg:hidden p-1.5 rounded-lg bg-surface-container text-on-surface hover:bg-surface-high"
        >
          <Icon name="menu" className="text-[20px]" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center text-primary">
            <Icon name="radar" className="text-[20px]" />
          </div>
          <span className="font-bold text-base tracking-tight text-white">FleetPulse</span>
          <span className="hidden sm:inline text-xs text-muted">/</span>
          <span className="hidden sm:inline text-xs font-medium text-slate-300 truncate">
            Fleet Health Dashboard
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-low border border-line text-xs font-mono text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          {onlineCount} Active {onlineCount === 1 ? "Unit" : "Units"}
        </div>

        {isMock && (
          <span
            title="Showing built-in sample data. Set apiBaseUrl in config.json to use the real API."
            className="px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-400"
          >
            Mock data
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-low border border-line shrink-0">
        <span
          className={`w-2 h-2 rounded-full ${hasError ? "bg-red-500" : "bg-primary animate-pulse"}`}
        />
        <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
          {hasError ? "Connection problem" : updatedText}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh now"
          aria-label="Refresh now"
          className="flex items-center text-slate-400 hover:text-white ml-0.5"
        >
          <Icon name="refresh" className="text-[16px] transition-transform duration-500 hover:rotate-180" />
        </button>
      </div>
    </header>
  );
}
