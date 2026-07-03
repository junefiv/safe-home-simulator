import { ROAD_SEGMENT_TOLERANCE_M } from "./constants";
import type { LatLng, RoadsData, WalkLine } from "./types";

export function isInsidePolygon(point: LatLng, polygon: LatLng[]): boolean {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: LatLng, v: LatLng, w: LatLng): number {
  const R = 6371000;
  const lat2y = (Math.PI / 180) * R;
  const lng2x = ((Math.PI / 180) * R * Math.cos((p.lat * Math.PI) / 180));

  const px = p.lng * lng2x;
  const py = p.lat * lat2y;
  const vx = v.lng * lng2x;
  const vy = v.lat * lat2y;
  const wx = w.lng * lng2x;
  const wy = w.lat * lat2y;

  const l2 = (wx - vx) ** 2 + (wy - vy) ** 2;
  if (l2 === 0) return Math.hypot(px - vx, py - vy);

  let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = vx + t * (wx - vx);
  const projY = vy + t * (wy - vy);
  return Math.hypot(px - projX, py - projY);
}

export function isWalkableHighway(highway: string | undefined): boolean {
  return Boolean(highway);
}

/** OSM 태그 기준 도로 폭(반경) — 지도에서 보이는 도로 폭에 맞게 넉넉히 */
export function estimateRoadHalfWidthM(tags?: Record<string, string>): number {
  const widthM = Number(tags?.width);
  if (!Number.isNaN(widthM) && widthM > 0) {
    return Math.max(widthM / 2 + 4, ROAD_SEGMENT_TOLERANCE_M);
  }

  const lanes = Number(tags?.lanes);
  if (!Number.isNaN(lanes) && lanes > 0) {
    return Math.max(lanes * 2, ROAD_SEGMENT_TOLERANCE_M);
  }

  const hw = tags?.highway ?? "";
  if (hw === "motorway" || hw === "motorway_link") return 28;
  if (hw === "trunk" || hw === "trunk_link") return 26;
  if (hw === "primary" || hw === "primary_link") return 24;
  if (hw === "secondary" || hw === "secondary_link") return 26;
  if (hw === "tertiary" || hw === "tertiary_link") return 20;
  if (
    hw === "footway" ||
    hw === "path" ||
    hw === "pedestrian" ||
    hw === "cycleway" ||
    hw === "steps" ||
    hw === "bridleway"
  ) {
    return 10;
  }
  if (hw === "track") return 12;
  if (
    hw === "service" ||
    hw === "living_street" ||
    hw === "residential" ||
    hw === "unclassified" ||
    hw === "road" ||
    hw === "busway" ||
    hw === "bus_guideway"
  ) {
    return 14;
  }
  if (
    hw === "construction" ||
    hw === "proposed" ||
    hw === "platform" ||
    hw === "raceway" ||
    hw === "corridor" ||
    hw === "elevator" ||
    hw === "escalator"
  ) {
    return 12;
  }
  return ROAD_SEGMENT_TOLERANCE_M;
}

function latLngPadForMeters(lat: number, meters: number): number {
  return meters / 111111;
}

function bboxToPolygon(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): LatLng[] {
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ];
}

export function createPositionValidator(roads: RoadsData) {
  const { walkLines, walkPolygons } = roads;
  return (lat: number, lng: number): boolean =>
    isValidPosition(lat, lng, walkLines, walkPolygons);
}

export function isValidPosition(
  lat: number,
  lng: number,
  walkLines: WalkLine[],
  walkPolygons: LatLng[][],
): boolean {
  if (walkLines.length === 0 && walkPolygons.length === 0) return false;

  const pt: LatLng = { lat, lng };

  for (const poly of walkPolygons) {
    if (isInsidePolygon(pt, poly)) return true;
  }

  for (const line of walkLines) {
    if (lat < line.minLat || lat > line.maxLat || lng < line.minLng || lng > line.maxLng) {
      continue;
    }
    if (distanceToSegment(pt, line.p1, line.p2) <= line.maxDistM) {
      return true;
    }
  }

  return false;
}

export function getNearestValidPoint(
  lat: number,
  lng: number,
  walkLines: WalkLine[],
): LatLng {
  if (walkLines.length === 0) return { lat, lng };

  let minDist = Infinity;
  let bestPt: LatLng = { lat, lng };

  for (const line of walkLines) {
    for (const p of [line.p1, line.p2]) {
      const d = distanceToSegment({ lat, lng }, p, p);
      if (d < minDist) {
        minDist = d;
        bestPt = p;
      }
    }
  }

  return bestPt;
}

export function slideMove(
  current: LatLng,
  nextLat: number,
  nextLng: number,
  isValid: (lat: number, lng: number) => boolean,
): LatLng {
  if (isValid(nextLat, nextLng)) {
    return { lat: nextLat, lng: nextLng };
  }

  const attempts: LatLng[] = [
    { lat: nextLat, lng: current.lng },
    { lat: current.lat, lng: nextLng },
    { lat: nextLat, lng: nextLng },
    {
      lat: current.lat + (nextLat - current.lat) * 0.5,
      lng: current.lng + (nextLng - current.lng) * 0.5,
    },
    { lat: nextLat, lng: current.lng + (nextLng - current.lng) * 0.5 },
    { lat: current.lat + (nextLat - current.lat) * 0.5, lng: nextLng },
  ];

  for (const pt of attempts) {
    if (isValid(pt.lat, pt.lng)) return pt;
  }

  return current;
}

/** 각 highway way를 도로 폭만큼 넓힌 통로 폴리곤으로 변환 */
function buildWayBufferPolygons(elements: OverpassElement[]): LatLng[][] {
  const polygons: LatLng[][] = [];

  for (const el of elements) {
    if (!el.geometry || el.geometry.length < 2) continue;
    if (!isWalkableHighway(el.tags?.highway)) continue;

    const halfW = estimateRoadHalfWidthM(el.tags);
    const pad = latLngPadForMeters(el.geometry[0].lat, halfW);
    const lats = el.geometry.map((p) => p.lat);
    const lngs = el.geometry.map((p) => p.lon);

    polygons.push(
      bboxToPolygon(
        Math.min(...lats) - pad,
        Math.max(...lats) + pad,
        Math.min(...lngs) - pad,
        Math.max(...lngs) + pad,
      ),
    );
  }

  return polygons;
}

interface OverpassElement {
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

function isStationElement(el: OverpassElement): boolean {
  return Boolean(
    el.tags &&
      (el.tags.building === "train_station" ||
        el.tags.railway === "station" ||
        el.tags.public_transport === "station"),
  );
}

export function parseOverpassRoads(elements: OverpassElement[]): RoadsData {
  const walkLines: WalkLine[] = [];
  const walkPolygons: LatLng[][] = [];

  for (const el of elements) {
    if (!el.geometry) continue;

    if (isStationElement(el) && el.geometry.length > 2) {
      walkPolygons.push(
        el.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon })),
      );
      continue;
    }

    const highway = el.tags?.highway;
    if (!isWalkableHighway(highway)) continue;

    const maxDistM = estimateRoadHalfWidthM(el.tags);

    for (let i = 0; i < el.geometry.length - 1; i++) {
      const p1 = el.geometry[i];
      const p2 = el.geometry[i + 1];
      const segPad = latLngPadForMeters(p1.lat, maxDistM);
      walkLines.push({
        p1: { lat: p1.lat, lng: p1.lon },
        p2: { lat: p2.lat, lng: p2.lon },
        minLat: Math.min(p1.lat, p2.lat) - segPad,
        maxLat: Math.max(p1.lat, p2.lat) + segPad,
        minLng: Math.min(p1.lon, p2.lon) - segPad,
        maxLng: Math.max(p1.lon, p2.lon) + segPad,
        maxDistM,
      });
    }
  }

  walkPolygons.push(...buildWayBufferPolygons(elements));

  return { walkLines, walkPolygons };
}
