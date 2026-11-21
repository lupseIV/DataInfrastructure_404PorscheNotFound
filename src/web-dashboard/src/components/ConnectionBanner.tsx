import { formatTimeUtc } from "../lib/format";
import { Icon } from "./Icon";

interface ConnectionBannerProps {
  error: string;
  /** Time of the last successful load, or null if nothing loaded yet. */
  lastUpdatedAt: number | null;
  onRetry: () => void;
}

/** Shown under the top bar when the device list can't be loaded. Old data stays visible. */
export function ConnectionBanner({ error, lastUpdatedAt, onRetry }: ConnectionBannerProps) {
  return (
    <div
      role="alert"
      className="px-3 lg:px-6 py-1.5 bg-red-500/10 border-b border-red-500/30 text-red-300 text-xs flex items-center gap-2 shrink-0 z-20"
    >
      <Icon name="cloud_off" className="text-[16px] shrink-0" />
      <span className="min-w-0 truncate">
        <span className="font-semibold">Can't reach the API.</span>{" "}
        {lastUpdatedAt !== null
          ? `Showing data from ${formatTimeUtc(lastUpdatedAt)} UTC. `
          : "No data loaded yet. "}
        <span className="font-mono text-red-300/80">{error}</span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto shrink-0 px-2 py-0.5 rounded border border-red-500/40 hover:bg-red-500/15 font-mono text-[11px]"
      >
        Retry
      </button>
    </div>
  );
}
