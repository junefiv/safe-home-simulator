import type { BlockPolygon } from "./blockPolygon";
import { wrapPolygons } from "./blockPolygon";
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

/** VWorld 노란 대로 — 건물 폴리곤과 겹쳐도 통행 허용 */
const MAJOR_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
]);

export function isMajorHighway(highway?: string): boolean {
  return Boolean(highway && MAJOR_HIGHWAYS.has(highway));
}

interface RoadMatch {
  onRoad: boolean;
  major: boolean;
}

function matchWalkRoad(
  pt: LatLng,
  lat: number,
  lng: number,
  walkLines: WalkLine[],
  walkPolygons: LatLng[][],
): RoadMatch {
  for (const poly of walkPolygons) {
    if (isInsidePolygon(pt, poly)) return { onRoad: true, major: true };
  }

  for (const line of walkLines) {
    if (lat < line.minLat || lat > line.maxLat || lng < line.minLng || lng > line.maxLng) {
      continue;
    }
    if (distanceToSegment(pt, line.p1, line.p2) <= line.maxDistM) {
      const major = isMajorHighway(line.highway) || line.maxDistM >= 28;
      return { onRoad: true, major };
    }
  }

  return { onRoad: false, major: false };
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
  // VWorld 노란 대로는 지도상 넓게 그려짐 — 허용 반경을 넉넉히
  if (hw === "motorway" || hw === "motorway_link") return 40;
  if (hw === "trunk" || hw === "trunk_link") return 38;
  if (hw === "primary" || hw === "primary_link") return 36;
  if (hw === "secondary" || hw === "secondary_link") return 32;
  if (hw === "tertiary" || hw === "tertiary_link") return 24;
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

function isInsideBlockPolygon(pt: LatLng, block: BlockPolygon): boolean {
  if (
    pt.lat < block.minLat ||
    pt.lat > block.maxLat ||
    pt.lng < block.minLng ||
    pt.lng > block.maxLng
  ) {
    return false;
  }
  return isInsidePolygon(pt, block.points);
}

function latLngPadForMeters(lat: number, meters: number): number {
  return meters / 111111;
}

export function createPositionValidator(roads: RoadsData) {
  const { walkLines, walkPolygons, blockPolygons = [] } = roads;
  return (lat: number, lng: number): boolean =>
    isValidPosition(lat, lng, walkLines, walkPolygons, blockPolygons);
}

export function isValidPosition(
  lat: number,
  lng: number,
  walkLines: WalkLine[],
  walkPolygons: LatLng[][],
  blockPolygons: BlockPolygon[] = [],
): boolean {
  if (walkLines.length === 0 && walkPolygons.length === 0) return false;

  const pt: LatLng = { lat, lng };
  const road = matchWalkRoad(pt, lat, lng, walkLines, walkPolygons);

  // 대로(면목로 등): 건물 데이터가 도로와 겹쳐도 통행
  if (road.onRoad && road.major) return true;

  // 골목·보조도로·도로 밖: 건물 내부 차단
  for (const block of blockPolygons) {
    if (isInsideBlockPolygon(pt, block)) return false;
  }

  return road.onRoad;
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

interface OverpassElement {
  type?: string;
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

/** 역사·문화재 건물은 통과 허용 */
function isHistoricBuilding(tags?: Record<string, string>): boolean {
  if (!tags) return false;
  if (tags.historic) return true;
  if (tags.heritage) return true;
  if (tags.building === "historic") return true;
  return false;
}

function isBlockingBuilding(el: OverpassElement): boolean {
  if (!el.geometry || el.geometry.length < 3) return false;
  if (isStationElement(el)) return false;

  const tags = el.tags;
  if (!tags) return false;
  if (tags.building === "no") return false;
  if (isHistoricBuilding(tags)) return false;

  if (tags.building && tags.building !== "no") return true;
  if (el.type === "relation" && tags.type === "building") return true;

  return false;
}

function geometryToPolygon(geometry: { lat: number; lon: number }[]): LatLng[] {
  return geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon }));
}

export function mergeBlockPolygons(
  existing: BlockPolygon[],
  incoming: LatLng[][],
): BlockPolygon[] {
  if (incoming.length === 0) return existing;
  return [...existing, ...wrapPolygons(incoming)];
}

export function parseOverpassBuildings(elements: OverpassElement[]): LatLng[][] {
  const blockPolygons: LatLng[][] = [];

  for (const el of elements) {
    if (!el.geometry) continue;
    if (isBlockingBuilding(el)) {
      blockPolygons.push(geometryToPolygon(el.geometry));
    }
  }

  return blockPolygons;
}

export function parseOverpassRoads(elements: OverpassElement[]): RoadsData {
  const walkLines: WalkLine[] = [];
  const walkPolygons: LatLng[][] = [];

  for (const el of elements) {
    if (!el.geometry) continue;

    if (isStationElement(el) && el.geometry.length > 2) {
      walkPolygons.push(geometryToPolygon(el.geometry));
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
        highway,
      });
    }
  }

  return { walkLines, walkPolygons, blockPolygons: [] };
}
