import type { BlockPolygon } from "./blockPolygon";
import { wrapPolygons } from "./blockPolygon";
import {
  ROAD_BRIDGE_MAX_M,
  ROAD_BUILDING_OVERLAP_SLACK_M,
  ROAD_JUNCTION_SLACK_M,
  ROAD_SEGMENT_TOLERANCE_M,
  WALKABLE_HIGHWAY_TYPES,
} from "./constants";
import { haversineDistance } from "./geo";
import type { LatLng, MovementLayer, RoadsData, WalkLine } from "./types";

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
  return Boolean(highway && WALKABLE_HIGHWAY_TYPES.has(highway));
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
  /** 건물 폴리곤과 겹치는 도로 구간 — 허용 반경을 넓힘 */
  buildingOverlap?: boolean;
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
  const widthSlackM = options.buildingOverlap ? ROAD_BUILDING_OVERLAP_SLACK_M : 0;

  for (const line of nearbyWalkLines(lat, lng, walkLines)) {
    if (!includeBridges && line.isBridge) continue;

    if (lat < line.minLat || lat > line.maxLat || lng < line.minLng || lng > line.maxLng) {
      continue;
    }
    if (distanceToSegment(pt, line.p1, line.p2) <= line.maxDistM + widthSlackM) {
      const major = isMajorHighway(line.highway) || line.maxDistM >= 28;
      return { onRoad: true, major };
    }
    if (endpointSlackM > 0) {
      const endSlack = line.maxDistM + endpointSlackM + widthSlackM;
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

function isInsideWalkableZone(pt: LatLng, walkPolygons: LatLng[][]): boolean {
  for (const poly of walkPolygons) {
    if (isInsidePolygon(pt, poly)) return true;
  }
  return false;
}

const ROAD_INDEX_CELL_DEG = 0.001;
const roadIndexCache = new WeakMap<WalkLine[], Map<string, WalkLine[]>>();

function getRoadIndex(walkLines: WalkLine[]): Map<string, WalkLine[]> {
  const cached = roadIndexCache.get(walkLines);
  if (cached) return cached;

  const index = new Map<string, WalkLine[]>();
  for (const line of walkLines) {
    const minRow = Math.floor(line.minLat / ROAD_INDEX_CELL_DEG);
    const maxRow = Math.floor(line.maxLat / ROAD_INDEX_CELL_DEG);
    const minCol = Math.floor(line.minLng / ROAD_INDEX_CELL_DEG);
    const maxCol = Math.floor(line.maxLng / ROAD_INDEX_CELL_DEG);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const key = `${row}:${col}`;
        const bucket = index.get(key);
        if (bucket) bucket.push(line);
        else index.set(key, [line]);
      }
    }
  }
  roadIndexCache.set(walkLines, index);
  return index;
}

function nearbyWalkLines(lat: number, lng: number, walkLines: WalkLine[]): WalkLine[] {
  const index = getRoadIndex(walkLines);
  const row = Math.floor(lat / ROAD_INDEX_CELL_DEG);
  const col = Math.floor(lng / ROAD_INDEX_CELL_DEG);
  const result: WalkLine[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const bucket = index.get(`${row + dr}:${col + dc}`);
      if (bucket) result.push(...bucket);
    }
  }
  return result;
}

function isOnWalkRoad(
  point: LatLng,
  walkLines: WalkLine[],
  buildingOverlap = false,
): boolean {
  return matchWalkRoadOnLines(point, point.lat, point.lng, walkLines, {
    includeBridges: true,
    endpointSlackM: ROAD_JUNCTION_SLACK_M,
    buildingOverlap,
  }).onRoad;
}

function isInsideAnyZone(pt: LatLng, polygons: LatLng[][]): boolean {
  return polygons.some((polygon) => isInsidePolygon(pt, polygon));
}

const BLOCK_INDEX_CELL_DEG = 0.001;
const blockIndexCache = new WeakMap<BlockPolygon[], Map<string, BlockPolygon[]>>();

function blockCellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / BLOCK_INDEX_CELL_DEG)}:${Math.floor(lng / BLOCK_INDEX_CELL_DEG)}`;
}

function getBlockIndex(blockPolygons: BlockPolygon[]): Map<string, BlockPolygon[]> {
  const cached = blockIndexCache.get(blockPolygons);
  if (cached) return cached;

  const index = new Map<string, BlockPolygon[]>();
  for (const block of blockPolygons) {
    const minRow = Math.floor(block.minLat / BLOCK_INDEX_CELL_DEG);
    const maxRow = Math.floor(block.maxLat / BLOCK_INDEX_CELL_DEG);
    const minCol = Math.floor(block.minLng / BLOCK_INDEX_CELL_DEG);
    const maxCol = Math.floor(block.maxLng / BLOCK_INDEX_CELL_DEG);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const key = `${row}:${col}`;
        const bucket = index.get(key);
        if (bucket) bucket.push(block);
        else index.set(key, [block]);
      }
    }
  }
  blockIndexCache.set(blockPolygons, index);
  return index;
}

function isInsideAnyBuilding(pt: LatLng, blockPolygons: BlockPolygon[]): boolean {
  const nearby = getBlockIndex(blockPolygons).get(blockCellKey(pt.lat, pt.lng)) ?? [];
  for (const block of nearby) {
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
export function bridgeRoadGaps(walkLines: WalkLine[]): WalkLine[] {
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

export interface MovementResolver {
  isValid(point: LatLng, layer: MovementLayer): boolean;
  canMove(current: LatLng, next: LatLng, layer: MovementLayer): boolean;
  resolveLayer(current: LatLng, next: LatLng, layer: MovementLayer): MovementLayer;
}

export function createMovementResolver(roads: RoadsData): MovementResolver {
  const isStation = (point: LatLng) =>
    isInsideAnyZone(point, roads.stationPolygons ?? []);

  const isOnSubwayLine = (point: LatLng) =>
    matchWalkRoadOnLines(
      point,
      point.lat,
      point.lng,
      roads.subwayLines ?? [],
      { includeBridges: true, endpointSlackM: ROAD_JUNCTION_SLACK_M },
    ).onRoad;

  const isOnSurfaceRoad = (point: LatLng) =>
    isOnWalkRoad(point, roads.walkLines, true);

  const isValid = (point: LatLng, layer: MovementLayer): boolean => {
    // 지하철역·지하철 노선은 지상 통행 시 막히지 않고 지나갈 수 있다.
    if (isStation(point) || isOnSubwayLine(point)) return true;

    if (layer === "underground") {
      return false;
    }

    // 도로 위면 건물 폴리곤보다 도로를 우선한다 (건물과 겹쳐도 통행).
    if (isOnSurfaceRoad(point)) return true;

    if (isInsideAnyBuilding(point, roads.blockPolygons ?? [])) return false;
    return isInsideWalkableZone(point, roads.walkPolygons ?? []);
  };

  return {
    isValid,
    canMove(_current, next, layer) {
      return isValid(next, layer);
    },
    resolveLayer(_current, next, layer) {
      if (isValid(next, layer)) return layer;
      return layer;
    },
  };
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

  // 도로 위면 건물보다 도로 우선
  if (isOnWalkRoad(pt, walkLines, true)) return true;

  if (isInsideAnyBuilding(pt, blockPolygons)) return false;

  if (isInsideWalkableZone(pt, walkPolygons)) return true;

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

/** 막힘 탈출용 — 기본 각도 + 역방향·넓은 우회 */
export const ZOMBIE_STUCK_PROBE_ANGLES = [
  ...ZOMBIE_PROBE_ANGLES,
  165, -165, 180, -180,
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
  lat?: number;
  lon?: number;
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

function isApartmentComplexElement(el: OverpassElement): boolean {
  const tags = el.tags;
  if (!tags || tags.landuse !== "residential") return false;

  const residential = tags.residential?.toLowerCase();
  if (residential === "apartments" || residential === "apartment") return true;

  const label = `${tags.name ?? ""} ${tags["name:ko"] ?? ""}`.toLowerCase();
  return /아파트|\bapt\.?\b|\bapartments?\b/.test(label);
}

function isUndergroundSubwayElement(el: OverpassElement): boolean {
  const tags = el.tags;
  if (!tags || tags.railway !== "subway") return false;
  const layer = Number(tags.layer ?? "0");
  return !(
    tags.bridge === "yes" ||
    tags.embankment === "yes" ||
    tags.location === "overground" ||
    layer > 0
  );
}

function isBlockingBuilding(el: OverpassElement): boolean {
  if (!el.geometry || el.geometry.length < 3) return false;
  if (isStationElement(el)) return false;

  const tags = el.tags;
  if (!tags) return false;
  if (tags.building === "no") return false;
  if (tags.building && tags.building !== "no") return true;
  if (el.type === "relation" && tags.type === "building") return true;

  return false;
}

function geometryToPolygon(geometry: { lat: number; lon: number }[]): LatLng[] {
  return geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon }));
}

function circlePolygon(lat: number, lng: number, radiusM = 24): LatLng[] {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2;
    return {
      lat: lat + (Math.sin(angle) * radiusM) / 111111,
      lng:
        lng +
        (Math.cos(angle) * radiusM) /
          (111111 * Math.cos((lat * Math.PI) / 180)),
    };
  });
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

export function parseOverpassTransit(elements: OverpassElement[]): {
  subwayLines: WalkLine[];
  stationPolygons: LatLng[][];
} {
  const subwayLines: WalkLine[] = [];
  const stationPolygons: LatLng[][] = [];

  for (const el of elements) {
    if (isStationElement(el) && el.lat !== undefined && el.lon !== undefined) {
      stationPolygons.push(circlePolygon(el.lat, el.lon));
      continue;
    }

    if (!el.geometry) continue;

    if (isStationElement(el) && el.geometry.length > 2) {
      stationPolygons.push(geometryToPolygon(el.geometry));
      continue;
    }

    if (isUndergroundSubwayElement(el)) {
      for (let i = 0; i < el.geometry.length - 1; i += 1) {
        subwayLines.push(
          makeWalkLine(
            { lat: el.geometry[i].lat, lng: el.geometry[i].lon },
            { lat: el.geometry[i + 1].lat, lng: el.geometry[i + 1].lon },
            8,
            "subway",
          ),
        );
      }
    }
  }

  return { subwayLines, stationPolygons };
}

export function parseOverpassRoads(elements: OverpassElement[]): RoadsData {
  const walkLines: WalkLine[] = [];
  const subwayLines: WalkLine[] = [];
  const stationPolygons: LatLng[][] = [];
  const apartmentPolygons: LatLng[][] = [];

  for (const el of elements) {
    if (isStationElement(el) && el.lat !== undefined && el.lon !== undefined) {
      stationPolygons.push(circlePolygon(el.lat, el.lon));
      continue;
    }

    if (!el.geometry) continue;

    if (isStationElement(el) && el.geometry.length > 2) {
      stationPolygons.push(geometryToPolygon(el.geometry));
      continue;
    }

    if (isApartmentComplexElement(el) && el.geometry.length > 2) {
      apartmentPolygons.push(geometryToPolygon(el.geometry));
      continue;
    }

    if (isUndergroundSubwayElement(el)) {
      for (let i = 0; i < el.geometry.length - 1; i++) {
        subwayLines.push(
          makeWalkLine(
            { lat: el.geometry[i].lat, lng: el.geometry[i].lon },
            { lat: el.geometry[i + 1].lat, lng: el.geometry[i + 1].lon },
            8,
            "subway",
          ),
        );
      }
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

  const walkPolygons = [...stationPolygons, ...apartmentPolygons];
  return {
    walkLines: bridged,
    subwayLines,
    walkPolygons,
    stationPolygons,
    apartmentPolygons,
    blockPolygons: [],
    buildingCoverage: [],
  };
}
