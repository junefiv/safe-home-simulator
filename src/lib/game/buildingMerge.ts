import type { LatLng } from "./types";

function polygonKey(poly: LatLng[]): string {
  if (poly.length === 0) return "";
  const p = poly[0];
  return `${p.lat.toFixed(5)}|${p.lng.toFixed(5)}|${poly.length}`;
}

export function mergePolygonLists(...lists: LatLng[][][]): LatLng[][] {
  const seen = new Set<string>();
  const out: LatLng[][] = [];

  for (const list of lists) {
    for (const poly of list) {
      if (poly.length < 3) continue;
      const key = polygonKey(poly);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(poly);
    }
  }

  return out;
}
