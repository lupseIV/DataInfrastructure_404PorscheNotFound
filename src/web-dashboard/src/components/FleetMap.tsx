import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { config } from "../config";
import { formatPercent } from "../lib/format";
import { getDevicePosition } from "../lib/location";
import { STATUS_GROUPS, groupInfo, type StatusGroup } from "../lib/status";
import type { Device } from "../types";
import type { DeviceRow } from "./DeviceSidebar";
import { Icon } from "./Icon";

interface FleetMapProps {
  rows: DeviceRow[];
  selectedDevice: Device | null;
  onSelect: (deviceId: string) => void;
  center: [number, number];
  zoom: number;
  loading: boolean;
  /** True when a status filter hides every device. */
  filtered: boolean;
  /** The device list could not be loaded and there is no older data to show. */
  loadFailed: boolean;
}

const MARKER_BORDER = "#0b1326";

const LEGEND_LABELS: Record<StatusGroup, string> = {
  critical: "Critical (<20%)",
  low: "Low (20–40%)",
  medium: "Medium (40–70%)",
  high: "High (≥70%)",
  charging: "Charging",
  offline: "Offline (>30s)",
};

export function FleetMap({
  rows,
  selectedDevice,
  onSelect,
  center,
  zoom,
  loading,
  filtered,
  loadFailed,
}: FleetMapProps) {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fittedOnce = useRef(false);
  // Legend starts folded on phones so it doesn't cover the map.
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth >= 640);

  const markers = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        position: getDevicePosition(row.device, center),
      })),
    [rows, center],
  );
  const anyApproximate = markers.some((m) => m.position.approximate);
  const selectedId = selectedDevice?.deviceId ?? null;

  // Keep Leaflet's size in sync when the side panels open or close.
  useEffect(() => {
    if (!map || !wrapperRef.current) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [map]);

  const fitAll = () => {
    if (!map || markers.length === 0) return;
    map.invalidateSize();
    if (markers.length === 1) {
      map.setView([markers[0].position.lat, markers[0].position.lng], 15);
      return;
    }
    map.fitBounds(
      markers.map((m) => [m.position.lat, m.position.lng] as [number, number]),
      { padding: [60, 60], maxZoom: 15 },
    );
  };

  // Frame all devices once, when they first load.
  useEffect(() => {
    if (!map || fittedOnce.current || markers.length === 0) return;
    fittedOnce.current = true;
    // Wait one frame so the map container has its final size.
    const id = window.requestAnimationFrame(fitAll);
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, markers.length]);

  // Fly to a device when it gets selected (from the list or the map).
  useEffect(() => {
    if (!map || !selectedDevice) return;
    const p = getDevicePosition(selectedDevice, center);
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
    // Only when the selection changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId]);

  const selectedMarker = markers.find((m) => m.device.deviceId === selectedId);

  return (
    // `isolate` keeps Leaflet's internal z-indexes (400+) from covering the drawer and bottom sheet.
    <div ref={wrapperRef} className="absolute inset-0 isolate">
      <MapContainer
        ref={setMap}
        center={center}
        zoom={zoom}
        zoomControl={false}
        className="h-full w-full"
        worldCopyJump
      >
        <TileLayer
          url={config.mapTileUrl}
          attribution={config.mapTileAttribution}
          maxZoom={19}
          className={config.mapDarkFilter ? "dark-tiles" : undefined}
        />

        {markers.map(({ device, group, position }) => {
          if (device.deviceId === selectedId) return null; // drawn last, on top
          const g = groupInfo(group);
          return (
            <CircleMarker
              key={device.deviceId}
              center={[position.lat, position.lng]}
              radius={7}
              pathOptions={{ color: MARKER_BORDER, weight: 2, fillColor: g.color, fillOpacity: 1 }}
              eventHandlers={{ click: () => onSelect(device.deviceId) }}
            >
              <Tooltip direction="top" offset={[0, -8]} className="device-label">
                {device.deviceId} · {group === "offline" ? "Offline" : formatPercent(device.batteryLevel)}
              </Tooltip>
            </CircleMarker>
          );
        })}

        {selectedMarker && (() => {
          const { device, group, position } = selectedMarker;
          const g = groupInfo(group);
          const latLng: [number, number] = [position.lat, position.lng];
          return (
            <>
              <CircleMarker
                center={latLng}
                radius={22}
                interactive={false}
                pathOptions={{ color: g.color, weight: 1.5, fill: false, className: "pulse-ring" }}
              />
              <CircleMarker
                center={latLng}
                radius={15}
                interactive={false}
                pathOptions={{ color: g.color, weight: 1.5, dashArray: "2 3", fillColor: g.color, fillOpacity: 0.18 }}
              />
              <CircleMarker
                center={latLng}
                radius={9}
                pathOptions={{ color: MARKER_BORDER, weight: 2.5, fillColor: g.color, fillOpacity: 1 }}
                eventHandlers={{ click: () => onSelect(device.deviceId) }}
              >
                <Tooltip permanent direction="top" offset={[0, -18]} className="device-label">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: g.color }} />
                  {device.deviceId}
                  <span className="ml-2" style={{ color: g.color }}>
                    {group === "offline" ? "Offline" : formatPercent(device.batteryLevel)}
                  </span>
                </Tooltip>
              </CircleMarker>
            </>
          );
        })()}
      </MapContainer>

      {/* Map controls (top right) */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
        <div className="flex flex-col bg-surface/90 backdrop-blur border border-line rounded-md overflow-hidden shadow-lg">
          <MapButton icon="add" label="Zoom in" onClick={() => map?.zoomIn()} />
          <div className="w-full h-px bg-line" />
          <MapButton icon="remove" label="Zoom out" onClick={() => map?.zoomOut()} />
        </div>
        <div className="bg-surface/90 backdrop-blur border border-line rounded-md overflow-hidden shadow-lg">
          <MapButton icon="fit_screen" label="Show all devices" onClick={fitAll} />
        </div>
        {selectedMarker && (
          <div className="bg-surface/90 backdrop-blur border border-line rounded-md overflow-hidden shadow-lg">
            <MapButton
              icon="filter_center_focus"
              label={`Center on ${selectedMarker.device.deviceId}`}
              onClick={() => map?.flyTo([selectedMarker.position.lat, selectedMarker.position.lng], Math.max(map.getZoom(), 15))}
            />
          </div>
        )}
      </div>

      {/* Legend (bottom left) */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-surface/90 backdrop-blur border border-line rounded-lg p-2.5 shadow-lg max-w-[calc(100%-1.5rem)]">
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          aria-expanded={legendOpen}
          className={`w-full flex items-center justify-between gap-4 ${legendOpen ? "mb-1.5" : ""}`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
            Telemetry Legend
          </span>
          <span className="flex items-center gap-1 text-[9px] font-mono text-primary">
            {markers.length} PINS
            <Icon name={legendOpen ? "expand_more" : "expand_less"} className="text-[14px] text-slate-400" />
          </span>
        </button>
        {legendOpen && (
        <>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
          {STATUS_GROUPS.map((g) => (
            <div key={g.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.color }} />
              <span className="text-slate-300">{LEGEND_LABELS[g.id]}</span>
            </div>
          ))}
        </div>
        {anyApproximate && (
          <p
            className="mt-2 pt-1.5 border-t border-line/60 text-[9px] font-mono text-amber-400/90 flex items-center gap-1"
            title="The backend does not send GPS coordinates yet, so devices are placed near the map center."
          >
            <Icon name="info" className="text-[12px]" />
            Approximate positions (no GPS data yet)
          </p>
        )}
        </>
        )}
      </div>

      {/* Loading and empty states */}
      {loading && markers.length === 0 && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
          <div className="px-4 py-3 rounded-lg bg-surface/90 border border-line text-xs font-mono text-slate-300 shadow-lg flex items-center gap-2">
            <Icon name="progress_activity" className="text-[18px] text-primary animate-spin" />
            Loading devices…
          </div>
        </div>
      )}
      {!loading && markers.length === 0 && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
          <div className="px-4 py-3 rounded-lg bg-surface/90 border border-line text-center shadow-lg">
            <Icon
              name={loadFailed ? "cloud_off" : filtered ? "filter_alt_off" : "satellite_alt"}
              className="text-[22px] text-slate-400"
            />
            <p className="mt-1 text-xs text-slate-300">
              {loadFailed
                ? "Could not load devices."
                : filtered
                  ? "No devices in this group."
                  : "No devices have reported yet."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function MapButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-surface-container transition-colors"
    >
      <Icon name={icon} className="text-[17px]" />
    </button>
  );
}
