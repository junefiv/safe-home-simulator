import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE_LAT = 111111;

export function haversineDistance(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function metersToLatLngDelta(
  metersNorth: number,
  metersEast: number,
  atLat: number,
): { dLat: number; dLng: number } {
  const dLat = metersNorth / METERS_PER_DEGREE_LAT;
  const dLng =
    metersEast / (METERS_PER_DEGREE_LAT * Math.cos((atLat * Math.PI) / 180));
  return { dLat, dLng };
}

export function offsetByMeters(
  origin: LatLng,
  metersNorth: number,
  metersEast: number,
): LatLng {
  const { dLat, dLng } = metersToLatLngDelta(metersNorth, metersEast, origin.lat);
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}