import type { LatLng } from "./types";

export interface BlockPolygon {
  points: LatLng[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function wrapPolygons(polygons: LatLng[][]): BlockPolygon[] {
  const out: BlockPolygon[] = [];
  for (const points of polygons) {
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
