import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { divIcon, type DivIcon, type Map as LeafletMap } from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { config } from "../config";
import { formatPercent, formatTimeUtc } from "../lib/format";
import { getDevicePosition } from "../lib/location";
import { toSegments } from "../lib/path";
import { NO_SIGNAL_DATA_COLOR, SIGNAL_COLORS } from "../lib/signal";
import { STATUS_GROUPS, groupInfo, isSuspect, type StatusGroup } from "../lib/status";
import type { Device, PathPoint } from "../types";
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
  /** A position to highlight (an event location or a last known position); the map flies to it. */
  focus?: MapFocus | null;
  /** Route of the selected device (GET .../path), oldest first. */
  path?: PathPoint[] | null;
  /** Changes when the user asks to frame the whole route. */
  fitPathRequest?: number;
}

const PATH_CASING = "#0b1326";

export interface MapFocus {
  lat: number;
  lng: number;
  label: string;
}

const FOCUS_COLOR = "#f59e0b";

const MARKER_BORDER = "#0b1326";

const LEGEND_LABELS: Record<StatusGroup, string> = {
  critical: "Critical (<20%)",
  low: "Low (20–40%)",
  medium: "Medium (40–70%)",
  high: "High (≥70%)",
  charging: "Charging",
  offline: "Offline",
};

const SUSPECT_BORDER = "#f59e0b";
/** Below this speed a device counts as not moving and gets no direction arrow. */
const MIN_MOVING_SPEED_MPS = 0.5;

const arrowIcons = new Map<string, DivIcon>();

/** Small arrow outside the marker, pointing in the direction of travel. Cached per color and angle. */
function headingIcon(color: string, degrees: number, distancePx: number): DivIcon {
  const angle = Math.round(degrees / 5) * 5; // fewer distinct icons to cache
  const key = `${color}|${angle}|${distancePx}`;
  let icon = arrowIcons.get(key);
  if (!icon) {
    const size = distancePx * 2 + 12;
    const c = size / 2;
    icon = divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [c, c],
      html:
        `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(${angle}deg)">` +
        `<path d="M${c} ${c - distancePx - 5} L${c + 4.5} ${c - distancePx + 2} L${c - 4.5} ${c - distancePx + 2} Z" ` +
        `fill="${color}" stroke="${MARKER_BORDER}" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    });
    arrowIcons.set(key, icon);
  }
  return icon;
}

function movingHeading(device: Device, group: StatusGroup): number | null {
  const h = device.heading;
  if (group === "offline" || !h) return null;
  if (typeof h.degrees !== "number" || typeof h.speedMps !== "number") return null;
  return h.speedMps >= MIN_MOVING_SPEED_MPS ? h.degrees : null;
}

export function FleetMap({
  rows,
  selectedDevice,
  onSelect,
  center,
  zoom,
  loading,
  filtered,
  loadFailed,
  focus = null,
  path = null,
  fitPathRequest = 0,
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
  const approximateCount = markers.filter((m) => m.position.approximate).length;
  const anyMoving = markers.some((m) => movingHeading(m.device, m.group) !== null);
  const anySuspect = markers.some((m) => isSuspect(m.device));
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

  // Fly to a highlighted position (event / last known position) when it changes.
  useEffect(() => {
    if (!map || !focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [map, focus]);

  const selectedMarker = markers.find((m) => m.device.deviceId === selectedId);

  const pathPoints = path ?? [];
  const segments = useMemo(() => toSegments(pathPoints), [pathPoints]);
  const showPath = selectedMarker !== undefined && pathPoints.length > 0;
  const pathStart = showPath ? pathPoints[0] : null;

  // Frame the whole route when the user asks for it.
  useEffect(() => {
    if (!map || fitPathRequest === 0 || pathPoints.length === 0) return;
    map.invalidateSize();
    map.fitBounds(pathPoints.map((pt) => [pt.lat, pt.lon] as [number, number]), { padding: [60, 60], maxZoom: 17 });
    // Only on request, not on every refresh of the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitPathRequest]);

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

        {showPath && (
          <>
            {/* Dark casing under each continuous piece so the route reads on any tile. */}
            {segments.map((seg, i) => (
              <Polyline
                key={`case-${i}`}
                positions={seg.positions}
                interactive={false}
                pathOptions={{ color: PATH_CASING, weight: 7, opacity: 0.75, lineCap: "round", lineJoin: "round" }}
              />
            ))}
            {segments.flatMap((seg, i) =>
              seg.runs.map((run, j) => (
                <Polyline
                  key={`run-${i}-${j}`}
                  positions={run.positions}
                  pathOptions={{ color: run.color, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }}
                >
                  <Tooltip sticky className="device-label">
                    {formatTimeUtc(run.from)}–{formatTimeUtc(run.to)} UTC ·{" "}
                    {typeof run.signalLevel === "number" ? `signal ${run.signalLevel}/4` : "no signal data"}
                  </Tooltip>
                </Polyline>
              )),
            )}
            {/* Where the line picks up again after an outage. */}
            {segments.slice(1).map((seg, i) => (
              <CircleMarker
                key={`resume-${i}`}
                center={seg.positions[0]}
                radius={3.5}
                interactive={false}
                pathOptions={{ color: "#e2e8f0", weight: 1.5, fillColor: PATH_CASING, fillOpacity: 1 }}
              />
            ))}
            {pathStart && (
              <CircleMarker
                center={[pathStart.lat, pathStart.lon]}
                radius={5}
                pathOptions={{ color: PATH_CASING, weight: 2, fillColor: "#e2e8f0", fillOpacity: 1 }}
              >
                <Tooltip direction="top" offset={[0, -6]} className="device-label">
                  Route start · {formatTimeUtc(pathStart.timestamp)} UTC
                </Tooltip>
              </CircleMarker>
            )}
          </>
        )}

        {markers.map(({ device, group, position }) => {
          if (device.deviceId === selectedId) return null; // drawn last, on top
          const g = groupInfo(group);
          const suspect = isSuspect(device);
          const heading = movingHeading(device, group);
          return (
            <Fragment key={device.deviceId}>
              {heading !== null && (
                <Marker
                  position={[position.lat, position.lng]}
                  icon={headingIcon(g.color, heading, 11)}
                  interactive={false}
                  keyboard={false}
                />
              )}
              <CircleMarker
                center={[position.lat, position.lng]}
                radius={7}
                pathOptions={{
                  color: suspect ? SUSPECT_BORDER : MARKER_BORDER,
                  weight: 2,
                  dashArray: suspect ? "3 2" : undefined,
                  fillColor: g.color,
                  fillOpacity: group === "offline" ? 0.6 : 1,
                }}
                eventHandlers={{ click: () => onSelect(device.deviceId) }}
              >
                <Tooltip direction="top" offset={[0, -8]} className="device-label">
                  {device.deviceId} · {group === "offline" ? "Offline" : formatPercent(device.batteryLevel)}
                  {suspect ? " · no data >1 min" : ""}
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}

        {selectedMarker && (() => {
          const { device, group, position } = selectedMarker;
          const g = groupInfo(group);
          const latLng: [number, number] = [position.lat, position.lng];
          const heading = movingHeading(device, group);
          return (
            <>
              {position.accuracyM !== null && position.accuracyM > 0 && (
                <Circle
                  center={latLng}
                  radius={position.accuracyM}
                  interactive={false}
                  pathOptions={{ color: g.color, weight: 1, dashArray: "4 4", fillColor: g.color, fillOpacity: 0.08 }}
                />
              )}
              {heading !== null && (
                <Marker position={latLng} icon={headingIcon(g.color, heading, 25)} interactive={false} keyboard={false} />
              )}
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
        {focus && (
          <>
            <CircleMarker
              center={[focus.lat, focus.lng]}
              radius={14}
              interactive={false}
              pathOptions={{ color: FOCUS_COLOR, weight: 2, dashArray: "3 3", fillColor: FOCUS_COLOR, fillOpacity: 0.12 }}
            />
            <CircleMarker
              center={[focus.lat, focus.lng]}
              radius={4}
              pathOptions={{ color: FOCUS_COLOR, weight: 2, fillColor: "#0b1326", fillOpacity: 1 }}
            >
              <Tooltip permanent direction="bottom" offset={[0, 14]} className="device-label">
                <span style={{ color: FOCUS_COLOR }}>◎</span> {focus.label}
              </Tooltip>
            </CircleMarker>
          </>
        )}
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
        {(anyMoving || anySuspect) && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-slate-300">
            {anyMoving && (
              <span className="flex items-center gap-1.5">
                <Icon name="navigation" className="text-[11px] text-slate-300" /> Direction of travel
              </span>
            )}
            {anySuspect && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full border border-dashed border-amber-400" /> No data &gt;1 min
              </span>
            )}
          </div>
        )}
        {showPath && (
          <div className="mt-1.5 pt-1.5 border-t border-line/60 text-[10px] font-mono text-slate-300">
            <span className="text-slate-400">Route signal</span>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {[
                { color: SIGNAL_COLORS[4], label: "Good" },
                { color: SIGNAL_COLORS[1], label: "Weak" },
                { color: SIGNAL_COLORS[0], label: "None" },
                { color: NO_SIGNAL_DATA_COLOR, label: "No data" },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1.5">
                  <span className="w-3 h-[3px] rounded-full" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5" title="No points for over a minute: the line is broken there">
                <span className="w-2 h-2 rounded-full border border-slate-200 bg-surface-deep" /> After a gap
              </span>
            </div>
          </div>
        )}
        {approximateCount > 0 && (
          <p
            className="mt-2 pt-1.5 border-t border-line/60 text-[9px] font-mono text-amber-400/90 flex items-center gap-1"
            title="These devices have not sent a GPS fix yet, so they are placed near the map center."
          >
            <Icon name="info" className="text-[12px]" />
            {approximateCount === markers.length
              ? "Approximate positions (no GPS data yet)"
              : `${approximateCount} without GPS fix (approximate position)`}
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
