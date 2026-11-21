// Map position of each device.
//
// Contract C sends `location: { lat, lon, accuracyM, capturedAt }` once the phone has a
// GPS fix. Until then (`location` missing or null) the device gets a fixed approximate
// position around the configured map center, derived from its ID so it doesn't jump
// between refreshes. The map legend says how many devices are placed approximately.

import type { Device } from "../types";

export interface DevicePosition {
  lat: number;
  lng: number;
  /** GPS accuracy radius in meters, or null for an approximate position. */
  accuracyM: number | null;
  approximate: boolean;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Small deterministic hash (FNV-1a) of a string, as a number in [0, 1). */
function hash01(text: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final mixing, so IDs that differ only in the last character land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const SPREAD_KM = 3; // approximate positions fall within this radius of the center

/** Moves a point `distanceM` meters in direction `bearingDeg` (0 = north). */
export function offsetPosition(
  lat: number,
  lng: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(rad)) / 111_320;
  const dLng = (distanceM * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

/** Fixed pseudo-random point near `center`, derived from the device ID. */
export function approximatePosition(deviceId: string, center: [number, number]): [number, number] {
  const bearing = hash01(deviceId, 1) * 360;
  const distanceM = (0.25 + 0.75 * Math.sqrt(hash01(deviceId, 2))) * SPREAD_KM * 1000;
  return offsetPosition(center[0], center[1], distanceM, bearing);
}

export function hasGpsFix(device: Device): boolean {
  const loc = device.location;
  return !!loc && isNum(loc.lat) && isNum(loc.lon);
}

export function getDevicePosition(device: Device, center: [number, number]): DevicePosition {
  const loc = device.location;
  if (loc && isNum(loc.lat) && isNum(loc.lon)) {
    return {
      lat: loc.lat,
      lng: loc.lon,
      accuracyM: isNum(loc.accuracyM) && loc.accuracyM >= 0 ? loc.accuracyM : null,
      approximate: false,
    };
  }
  const [lat, lng] = approximatePosition(device.deviceId, center);
  return { lat, lng, accuracyM: null, approximate: true };
}
