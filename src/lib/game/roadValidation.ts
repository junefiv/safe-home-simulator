import type { BlockPolygon } from "./blockPolygon";
import { wrapPolygons } from "./blockPolygon";
import {
  ROAD_BRIDGE_MAX_M,
  ROAD_JUNCTION_SLACK_M,
  ROAD_SEGMENT_TOLERANCE_M,
  ROAD_STRICT_ENDPOINT_SLACK_M,
} from "./constants";
import { haversineDistance } from "./geo";
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

interface RoadMatchOptions {
  /** false면 OSM 원본 세그먼트만 (건물 안 판정용) */
  includeBridges?: boolean;
  endpointSlackM?: number;
}

function matchWalkRoadOnLines(
  pt: LatLng,
  lat: number,
  lng: number,
  walkLines: WalkLine[],
  options: RoadMatchOptions = {},
): RoadMatch {
  const includeBridges = options.includeBridges ?? true;
  const endpointSlackM = options.endpointSlackM ?? ROAD_JUNCTION_SLACK_M;

  for (const line of walkLines) {
    if (!includeBridges && line.isBridge) continue;

    if (lat < line.minLat || lat > line.maxLat || lng < line.minLng || lng > line.maxLng) {
      continue;
    }
    if (distanceToSegment(pt, line.p1, line.p2) <= line.maxDistM) {
      const major = isMajorHighway(line.highway) || line.maxDistM >= 28;
      return { onRoad: true, major };
    }
    if (endpointSlackM > 0) {
      const endSlack = line.maxDistM + endpointSlackM;
      if (
        haversineDistance(pt, line.p1) <= endSlack ||
        haversineDistance(pt, line.p2) <= endSlack
      ) {
        return { onRoad: true, major: isMajorHighway(line.highway) };
      }
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

function isInsideStationZone(pt: LatLng, walkPolygons: LatLng[][]): boolean {
  for (const poly of walkPolygons) {
    if (isInsidePolygon(pt, poly)) return true;
  }
  return false;
}

function isInsideAnyBuilding(pt: LatLng, blockPolygons: BlockPolygon[]): boolean {
  for (const block of blockPolygons) {
    if (isInsideBlockPolygon(pt, block)) return true;
  }
  return false;
}

function latLngPadForMeters(lat: number, meters: number): number {
  return meters / 111111;
}

function makeWalkLine(
  p1: LatLng,
  p2: LatLng,
  maxDistM: number,
  highway?: string,
  isBridge = false,
): WalkLine {
  const segPad = latLngPadForMeters(p1.lat, maxDistM + ROAD_JUNCTION_SLACK_M);
  return {
    p1,
    p2,
    minLat: Math.min(p1.lat, p2.lat) - segPad,
    maxLat: Math.max(p1.lat, p2.lat) + segPad,
    minLng: Math.min(p1.lng, p2.lng) - segPad,
    maxLng: Math.max(p1.lng, p2.lng) + segPad,
    maxDistM,
    highway,
    isBridge,
  };
}

interface RoadEndpoint {
  pt: LatLng;
  maxDistM: number;
  highway?: string;
}

/** OSM way 끝점이 1~16m 떨어진 곳을 잇는 보조 세그먼트 (교차로·타일 경계 끊김 완화) */
function bridgeRoadGaps(walkLines: WalkLine[]): WalkLine[] {
  const endpoints: RoadEndpoint[] = [];
  for (const line of walkLines) {
    endpoints.push({ pt: line.p1, maxDistM: line.maxDistM, highway: line.highway });
    endpoints.push({ pt: line.p2, maxDistM: line.maxDistM, highway: line.highway });
  }
  if (endpoints.length < 2) return walkLines;

  const cellDeg = ROAD_BRIDGE_MAX_M / 111111;
  const grid = new Map<string, RoadEndpoint[]>();

  const cellKey = (lat: number, lng: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`;

  for (const ep of endpoints) {
    const key = cellKey(ep.pt.lat, ep.pt.lng);
    const bucket = grid.get(key);
    if (bucket) bucket.push(ep);
    else grid.set(key, [ep]);
  }

  const bridges: WalkLine[] = [];
  const seen = new Set<string>();

  for (const [key, bucket] of grid) {
    const [row, col] = key.split(":").map(Number);
    const neighbors: RoadEndpoint[] = [...bucket];

    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nearby = grid.get(`${row + dr}:${col + dc}`);
        if (nearby) neighbors.push(...nearby);
      }
    }

    for (const a of bucket) {
      for (const b of neighbors) {
        if (a === b) continue;
        const dist = haversineDistance(a.pt, b.pt);
        if (dist < 0.8 || dist > ROAD_BRIDGE_MAX_M) continue;

        const pairKey =
          a.pt.lat < b.pt.lat || (a.pt.lat === b.pt.lat && a.pt.lng <= b.pt.lng)
            ? `${a.pt.lat.toFixed(6)}:${a.pt.lng.toFixed(6)}|${b.pt.lat.toFixed(6)}:${b.pt.lng.toFixed(6)}`
            : `${b.pt.lat.toFixed(6)}:${b.pt.lng.toFixed(6)}|${a.pt.lat.toFixed(6)}:${a.pt.lng.toFixed(6)}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const width = Math.max(a.maxDistM, b.maxDistM, ROAD_SEGMENT_TOLERANCE_M);
        bridges.push(makeWalkLine(a.pt, b.pt, width, a.highway ?? b.highway, true));
      }
    }
  }

  return bridges.length > 0 ? [...walkLines, ...bridges] : walkLines;
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

  // 지하철역·기차역 구역은 건물과 무관하게 통과
  if (isInsideStationZone(pt, walkPolygons)) return true;

  const insideBuilding = isInsideAnyBuilding(pt, blockPolygons);

  // 건물 안: OSM 도로 중심선 위만 통과 (보조 bridge·넓은 여유 미적용)
  if (insideBuilding) {
    return matchWalkRoadOnLines(pt, lat, lng, walkLines, {
      includeBridges: false,
      endpointSlackM: ROAD_STRICT_ENDPOINT_SLACK_M,
    }).onRoad;
  }

  // 건물 밖: 도로 + 교차로 연결(bridge) 허용
  return matchWalkRoadOnLines(pt, lat, lng, walkLines, {
    includeBridges: true,
    endpointSlackM: ROAD_JUNCTION_SLACK_M,
  }).onRoad;
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

  const dy = nextLat - current.lat;
  const dx = nextLng - current.lng;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return current;

  const approxMeters = dist * 111111;
  return navigateToward(
    current,
    { lat: nextLat, lng: nextLng },
    approxMeters,
    isValid,
    { probeAngles: PLAYER_PROBE_ANGLES },
  );
}

const PLAYER_PROBE_ANGLES = [0, 28, -28, 55, -55, 82, -82, 110, -110];

/** 좀비용 — 더 많은 각도로 건물 모서리 우회 */
const ZOMBIE_PROBE_ANGLES = [
  0, 12, -12, 24, -24, 36, -36, 48, -48, 60, -60, 75, -75, 90, -90, 105, -105,
  120, -120, 135, -135, 150, -150,
];

function deltaFromHeading(
  lat: number,
  headingRad: number,
  meters: number,
): { lat: number; lng: number } {
  const dy = Math.sin(headingRad);
  const dx = Math.cos(headingRad);
  return {
    lat: (dy * meters) / 111111,
    lng: (dx * meters) / (111111 * Math.cos((lat * Math.PI) / 180)),
  };
}

export interface NavigateOptions {
  flee?: boolean;
  probeAngles?: number[];
}

/**
 * 목표 방향으로 이동. 막히면 좌우 각도·짧은 보폭으로 건물을 우회.
 */
export function navigateToward(
  current: LatLng,
  target: LatLng,
  metersMoved: number,
  isValid: (lat: number, lng: number) => boolean,
  options: NavigateOptions = {},
): LatLng {
  let dy = target.lat - current.lat;
  let dx = target.lng - current.lng;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || metersMoved <= 0) return current;

  dx /= dist;
  dy /= dist;
  if (options.flee) {
    dx = -dx;
    dy = -dy;
  }

  const baseAngle = Math.atan2(dy, dx);
  const angles = options.probeAngles ?? PLAYER_PROBE_ANGLES;

  for (const stepScale of [1, 0.65, 0.4]) {
    const stepM = metersMoved * stepScale;
    for (const deg of angles) {
      const delta = deltaFromHeading(current.lat, baseAngle + (deg * Math.PI) / 180, stepM);
      const nextLat = current.lat + delta.lat;
      const nextLng = current.lng + delta.lng;
      if (isValid(nextLat, nextLng)) {
        return { lat: nextLat, lng: nextLng };
      }
    }
  }

  // 벽 따라 미끄러짐 — 이동 방향에 수직
  for (const deg of [90, -90, 120, -120]) {
    const delta = deltaFromHeading(current.lat, baseAngle + (deg * Math.PI) / 180, metersMoved * 0.45);
    const nextLat = current.lat + delta.lat;
    const nextLng = current.lng + delta.lng;
    if (isValid(nextLat, nextLng)) {
      return { lat: nextLat, lng: nextLng };
    }
  }

  const attempts: LatLng[] = [
    { lat: target.lat, lng: current.lng },
    { lat: current.lat, lng: target.lng },
    {
      lat: current.lat + (target.lat - current.lat) * 0.5,
      lng: current.lng + (target.lng - current.lng) * 0.5,
    },
  ];

  for (const pt of attempts) {
    if (isValid(pt.lat, pt.lng)) return pt;
  }

  return current;
}

export { ZOMBIE_PROBE_ANGLES };

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
        el.tags.railway === "subway_entrance" ||
        el.tags.station === "subway" ||
        el.tags.subway === "yes" ||
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
      walkLines.push(
        makeWalkLine(
          { lat: p1.lat, lng: p1.lon },
          { lat: p2.lat, lng: p2.lon },
          maxDistM,
          highway,
        ),
      );
    }
  }

  const bridged = bridgeRoadGaps(walkLines);

  return { walkLines: bridged, walkPolygons, blockPolygons: [] };
}
