import type { LatLng } from "./types";
import { BUILDING_COLLISION_INSET_M } from "./constants";

const METERS_PER_DEG_LAT = 111111;

/** 건물 윤곽을 안쪽으로 줄여 좁은 도로 통행 여유를 확보한다. */
function shrinkPolygon(points: LatLng[], insetM: number): LatLng[] {
  if (points.length < 3 || insetM <= 0) return points;

  let cLat = 0;
  let cLng = 0;
  for (const p of points) {
    cLat += p.lat;
    cLng += p.lng;
  }
  cLat /= points.length;
  cLng /= points.length;

  return points.map((p) => {
    const dLat = cLat - p.lat;
    const dLng = cLng - p.lng;
    const distM = Math.hypot(
      dLat * METERS_PER_DEG_LAT,
      dLng * METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180),
    );
    if (distM < insetM * 2) return p;
    const t = insetM / distM;
    return { lat: p.lat + dLat * t, lng: p.lng + dLng * t };
  });
}

export interface BlockPolygon {
  points: LatLng[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function wrapPolygons(
  polygons: LatLng[][],
  insetM = BUILDING_COLLISION_INSET_M,
): BlockPolygon[] {
  const out: BlockPolygon[] = [];
  for (const raw of polygons) {
    const points = insetM > 0 ? shrinkPolygon(raw, insetM) : raw;
    if (points.length < 3) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    out.push({ points, minLat, maxLat, minLng, maxLng });
  }
  return out;
}

export function cellStorageKey(row: number, col: number): string {
  return `${row}:${col}`;
}
