import type { Bbox, LatLng } from "./types";

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

export function bboxAroundPoint(lat: number, lng: number, radiusM: number): Bbox {
  const latPad = radiusM / METERS_PER_DEGREE_LAT;
  const lngPad = radiusM / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - latPad,
    west: lng - lngPad,
    north: lat + latPad,
    east: lng + lngPad,
  };
}

/** 점에서 선분까지 최단 거리(미터) */
export function distancePointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  return haversineDistance(p, projectPointToSegment(p, a, b));
}

/** 점을 선분 위에 투영한 좌표 */
export function projectPointToSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const latScale = METERS_PER_DEGREE_LAT;
  const lngScale = METERS_PER_DEGREE_LAT * Math.cos((p.lat * Math.PI) / 180);
  const ax = a.lng * lngScale;
  const ay = a.lat * latScale;
  const bx = b.lng * lngScale;
  const by = b.lat * latScale;
  const px = p.lng * lngScale;
  const py = p.lat * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { ...a };

  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return {
    lat: (ay + t * dy) / latScale,
    lng: (ax + t * dx) / lngScale,
  };
}

/** 점에서 경로(폴리라인)까지 최단 거리(미터) */
export function distancePointToRouteM(point: LatLng, route: LatLng[]): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return haversineDistance(point, route[0]);

  let min = Infinity;
  for (let i = 1; i < route.length; i += 1) {
    min = Math.min(min, distancePointToSegmentM(point, route[i - 1], route[i]));
  }
  return min;
}

/** 점을 경로(폴리라인) 위에 투영한 좌표 */
export function projectPointToRoute(point: LatLng, route: LatLng[]): LatLng {
  if (route.length === 0) return point;
  if (route.length === 1) return route[0];

  let best = route[0];
  let bestDist = Infinity;
  for (let i = 1; i < route.length; i += 1) {
    const proj = projectPointToSegment(point, route[i - 1], route[i]);
    const d = haversineDistance(point, proj);
    if (d < bestDist) {
      bestDist = d;
      best = proj;
    }
  }
  return best;
}