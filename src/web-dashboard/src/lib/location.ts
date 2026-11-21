// Map position of each device.
//
// The backend does not send coordinates yet. When a device has `latitude` and
// `longitude`, those are used. Otherwise the device gets a fixed approximate
// position around the configured map center, derived from its ID so it doesn't
// jump between refreshes. The map shows a note whenever approximate positions are used.

import type { Device } from "../types";

export interface DevicePosition {
  lat: number;
  lng: number;
  approximate: boolean;
}

const isCoord = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

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

export function getDevicePosition(device: Device, center: [number, number]): DevicePosition {
  if (isCoord(device.latitude) && isCoord(device.longitude)) {
    return { lat: device.latitude, lng: device.longitude, approximate: false };
  }

  const angle = hash01(device.deviceId, 1) * 2 * Math.PI;
  const distanceKm = (0.25 + 0.75 * Math.sqrt(hash01(device.deviceId, 2))) * SPREAD_KM;
  const [lat, lng] = center;
  const dLat = (distanceKm / 111.32) * Math.sin(angle);
  const dLng = (distanceKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle);
  return { lat: lat + dLat, lng: lng + dLng, approximate: true };
}
