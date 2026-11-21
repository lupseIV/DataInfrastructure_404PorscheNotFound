import { useMemo, useState } from "react";
import { getDeviceAlerts, getDevicePath, getDeviceTelemetry, getDevices } from "./api";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { DeviceDetailPanel } from "./components/DeviceDetailPanel";
import { DeviceSidebar, type DeviceRow } from "./components/DeviceSidebar";
import { FleetMap, type MapFocus } from "./components/FleetMap";
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
  // Position highlighted on the map from the detail panel (event or last known position).
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  // Route window of the open device (Contract C #4 presets) and "frame the route" requests.
  const [routeMinutes, setRouteMinutes] = useState(10);
  const [fitRouteRequest, setFitRouteRequest] = useState(0);

  const rows: DeviceRow[] = useMemo(
    () =>
      (devicesPoll.data ?? []).map((device) => ({
        device,
        group: getStatusGroup(device, now, config.staleAfterMs),
      })),
    [devicesPoll.data, now],
  );

  const loadFailed = devicesPoll.error !== null && devicesPoll.data === null;

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

  const selectedRow = rows.find((r) => r.device.deviceId === selectedId) ?? null;
  const selectedDevice = selectedRow?.device ?? null;

  // History of the open device only; polling stops when the panel closes.
  const historyPoll = usePolling(
    (signal) => getDeviceTelemetry(selectedId!, config.historyLimit, signal),
    config.pollIntervalMs,
    selectedId,
  );

  // Battery and connectivity events of the open device (alerts endpoint).
  const alertsPoll = usePolling(
    (signal) => getDeviceAlerts(selectedId!, config.historyLimit, signal),
    config.pollIntervalMs,
    selectedId,
  );

  // Route of the open device; a new window starts a new poll.
  const routePoll = usePolling(
    (signal) => getDevicePath(selectedId!, routeMinutes, signal),
    config.pollIntervalMs,
    selectedId ? `${selectedId}|${routeMinutes}` : null,
  );

  const selectDevice = (deviceId: string) => {
    setSelectedId(deviceId);
    setMapFocus(null);
    setMobileSidebarOpen(false);
  };

  const closeDetails = () => {
    setSelectedId(null);
    setMapFocus(null);
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

      {devicesPoll.error && (
        <ConnectionBanner
          error={devicesPoll.error}
          lastUpdatedAt={devicesPoll.updatedAt}
          onRetry={devicesPoll.refresh}
        />
      )}

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
          loadFailed={loadFailed}
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
              loadFailed={loadFailed}
              focus={mapFocus}
              path={selectedId && routePoll.data?.deviceId === selectedId ? routePoll.data.points : null}
              fitPathRequest={fitRouteRequest}
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

        {selectedRow && (
          <DeviceDetailPanel
            device={selectedRow.device}
            group={selectedRow.group}
            now={now}
            history={historyPoll.data?.records ?? null}
            historyLoading={historyPoll.loading}
            historyError={historyPoll.error}
            alerts={alertsPoll.data}
            alertsLoading={alertsPoll.loading}
            alertsError={alertsPoll.error}
            onShowOnMap={(location, label) => setMapFocus({ lat: location.lat, lng: location.lon, label })}
            route={routePoll.data}
            routeLoading={routePoll.loading}
            routeError={routePoll.error}
            routeMinutes={routeMinutes}
            onRouteMinutesChange={setRouteMinutes}
            onFitRoute={() => {
              setMapFocus(null);
              setFitRouteRequest((n) => n + 1);
            }}
            onClose={closeDetails}
          />
        )}
      </div>
    </div>
  );
}
