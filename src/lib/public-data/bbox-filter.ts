import type { Bbox, NormalizedFacility } from "./types";

/** WFS 조회 시 최소 반경 (~500m). 출발·도착이 가까우면 bbox가 너무 좁아져 0건이 나올 수 있음 */
const MIN_HALF_LAT_DEG = 0.005;
const MIN_HALF_LNG_DEG = 0.006;

export function ensureMinimumBbox(bbox: Bbox): Bbox {
  const latCenter = (bbox.south + bbox.north) / 2;
  const lngCenter = (bbox.west + bbox.east) / 2;
  const latHalf = Math.max((bbox.north - bbox.south) / 2, MIN_HALF_LAT_DEG);
  const lngHalf = Math.max((bbox.east - bbox.west) / 2, MIN_HALF_LNG_DEG);
  return {
    south: latCenter - latHalf,
    north: latCenter + latHalf,
    west: lngCenter - lngHalf,
    east: lngCenter + lngHalf,
  };
}

export function filterByBbox(
  facilities: NormalizedFacility[],
  bbox: Bbox,
): NormalizedFacility[] {
  return facilities.filter(
    (f) =>
      f.lat >= bbox.south &&
      f.lat <= bbox.north &&
      f.lng >= bbox.west &&
      f.lng <= bbox.east,
  );
}