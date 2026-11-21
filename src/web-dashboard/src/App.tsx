import { useMemo, useState } from "react";
import { getDevices } from "./api";
import { DeviceSidebar, type DeviceRow } from "./components/DeviceSidebar";
import { FleetMap } from "./components/FleetMap";
import { Icon } from "./components/Icon";
import { StatusFilterBar } from "./components/StatusFilterBar";
import { TopBar } from "./components/TopBar";
import { config } from "./config";
import { useNow } from "./hooks/useNow";
import { usePolling } from "./hooks/usePolling";
import { countByGroup, getStatusGroup, groupInfo, type StatusGroup } from "./lib/status";

export default function App() {
  const now = useNow();
  const devicesPoll = usePolling(getDevices, config.pollIntervalMs, "devices");

  const [statusFilter, setStatusFilter] = useState<StatusGroup | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const rows: DeviceRow[] = useMemo(
    () =>
      (devicesPoll.data ?? []).map((device) => ({
        device,
        group: getStatusGroup(device, now, config.staleAfterMs),
      })),
    [devicesPoll.data, now],
  );

  const counts = useMemo(() => countByGroup(rows.map((r) => r.group)), [rows]);
  const onlineCount = rows.length - counts.offline;

  // The status filter applies to the list and the map; the search only to the list.
  const filteredRows = useMemo(
    () => (statusFilter ? rows.filter((r) => r.group === statusFilter) : rows),
    [rows, statusFilter],
  );
  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? filteredRows.filter((r) => r.device.deviceId.toLowerCase().includes(q)) : filteredRows;
  }, [filteredRows, search]);

  const selectedDevice = rows.find((r) => r.device.deviceId === selectedId)?.device ?? null;

  const selectDevice = (deviceId: string) => {
    setSelectedId(deviceId);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="h-full w-full flex flex-col">
      <TopBar
        onlineCount={onlineCount}
        lastUpdatedAt={devicesPoll.updatedAt}
        now={now}
        isMock={config.useMockData}
        hasError={devicesPoll.error !== null}
        onRefresh={devicesPoll.refresh}
        onToggleSidebar={() => setMobileSidebarOpen((open) => !open)}
      />

      <div className="flex-1 min-h-0 w-full flex relative overflow-hidden">
        <DeviceSidebar
          rows={listRows}
          totalCount={rows.length}
          filterLabel={statusFilter ? `Filter: ${groupInfo(statusFilter).label}` : null}
          search={search}
          onSearchChange={setSearch}
          selectedId={selectedId}
          onSelect={selectDevice}
          loading={devicesPoll.loading}
          collapsed={sidebarCollapsed}
          onCollapse={() => setSidebarCollapsed(true)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden bg-map">
          <StatusFilterBar counts={counts} active={statusFilter} onChange={setStatusFilter} />

          <div className="flex-1 min-h-0 relative">
            <FleetMap
              rows={filteredRows}
              selectedDevice={selectedDevice}
              onSelect={selectDevice}
              center={config.mapCenter}
              zoom={config.mapZoom}
              loading={devicesPoll.loading}
              filtered={statusFilter !== null && rows.length > 0}
            />
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="hidden lg:flex absolute top-3 left-3 z-[500] items-center gap-2 px-3 py-2 rounded-lg bg-surface/90 backdrop-blur border border-line text-sm text-slate-200 hover:text-white shadow-lg"
              >
                <Icon name="keyboard_double_arrow_right" className="text-[16px] text-primary" />
                Units <span className="font-mono text-primary">({rows.length})</span>
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
