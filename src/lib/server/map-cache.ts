import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Bbox, LatLng, RoadsData, WalkLine } from "@/lib/game/types";

interface RoadsCacheEntry {
  bbox: Bbox & { name?: string };
  roads: RoadsData;
}

interface BuildingsCacheEntry {
  bbox: Bbox & { name?: string };
  blockPolygons: LatLng[][];
}

interface RoadsCacheFile {
  generatedAt?: string;
  entries?: RoadsCacheEntry[];
}

interface BuildingsCacheFile {
  generatedAt?: string;
  entries?: BuildingsCacheEntry[];
}

interface ShardIndexCell {
  name: string;
  south: number;
  west: number;
  north: number;
  east: number;
  roads: string;
  buildings: string;
}

interface ShardIndexFile {
  generatedAt?: string | null;
  cells?: ShardIndexCell[];
}

const CACHE_DIR = join(process.cwd(), ".cache");
const ROADS_CACHE_PATH = join(CACHE_DIR, "roads-cache.json");
const BUILDINGS_CACHE_PATH = join(CACHE_DIR, "buildings-cache.json");
const SHARD_DIR = join(CACHE_DIR, "map-cache");
const INDEX_PATH = join(SHARD_DIR, "index.json");

let roadsCache: RoadsCacheFile | null | undefined;
let buildingsCache: BuildingsCacheFile | null | undefined;
let shardIndex: ShardIndexFile | null | undefined;
const roadsShardMemo = new Map<string, RoadsCacheEntry | null>();
const buildingsShardMemo = new Map<string, BuildingsCacheEntry | null>();

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path);
    const text = path.endsWith(".gz")
      ? gunzipSync(raw).toString("utf8")
      : raw.toString("utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn("[map-cache] failed to read", path, err);
    return null;
  }
}

function resolveShardPath(relativePath: string): string {
  const primary = join(SHARD_DIR, relativePath);
  if (existsSync(primary)) return primary;
  // 구버전 비압축 .json 폴백
  if (relativePath.endsWith(".json.gz")) {
    const legacy = join(SHARD_DIR, relativePath.slice(0, -3));
    if (existsSync(legacy)) return legacy;
  }
  return primary;
}

function getRoadsCache(): RoadsCacheFile | null {
  roadsCache ??= readJsonFile<RoadsCacheFile>(ROADS_CACHE_PATH);
  return roadsCache;
}

function getBuildingsCache(): BuildingsCacheFile | null {
  buildingsCache ??= readJsonFile<BuildingsCacheFile>(BUILDINGS_CACHE_PATH);
  return buildingsCache;
}

function getShardIndex(): ShardIndexFile | null {
  shardIndex ??= readJsonFile<ShardIndexFile>(INDEX_PATH);
  return shardIndex;
}

function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer.south <= inner.south &&
    outer.west <= inner.west &&
    outer.north >= inner.north &&
    outer.east >= inner.east
  );
}

function lineIntersectsBbox(line: WalkLine, bbox: Bbox): boolean {
  return (
    line.minLng <= bbox.east &&
    line.maxLng >= bbox.west &&
    line.minLat <= bbox.north &&
    line.maxLat >= bbox.south
  );
}

function polygonBbox(poly: LatLng[]): Bbox | null {
  if (poly.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of poly) {
    south = Math.min(south, point.lat);
    west = Math.min(west, point.lng);
    north = Math.max(north, point.lat);
    east = Math.max(east, point.lng);
  }
  return { south, west, north, east };
}

function polygonIntersectsBbox(poly: LatLng[], bbox: Bbox): boolean {
  const pb = polygonBbox(poly);
  return pb ? bboxIntersects(pb, bbox) : false;
}

function dedupeLines(lines: WalkLine[]): WalkLine[] {
  const seen = new Set<string>();
  const out: WalkLine[] = [];
  for (const line of lines) {
    const key = [
      line.p1.lat.toFixed(6),
      line.p1.lng.toFixed(6),
      line.p2.lat.toFixed(6),
      line.p2.lng.toFixed(6),
      Math.round(line.maxDistM),
      line.highway ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function dedupePolygons(polygons: LatLng[][]): LatLng[][] {
  const seen = new Set<string>();
  const out: LatLng[][] = [];
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    const key = `${poly[0].lat.toFixed(6)}|${poly[0].lng.toFixed(6)}|${poly.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(poly);
  }
  return out;
}

function cellToBbox(cell: ShardIndexCell): Bbox {
  return {
    south: cell.south,
    west: cell.west,
    north: cell.north,
    east: cell.east,
  };
}

function loadRoadsShard(cell: ShardIndexCell): RoadsCacheEntry | null {
  const cached = roadsShardMemo.get(cell.name);
  if (cached !== undefined) return cached;
  const entry = readJsonFile<RoadsCacheEntry>(resolveShardPath(cell.roads));
  roadsShardMemo.set(cell.name, entry);
  return entry;
}

function loadBuildingsShard(cell: ShardIndexCell): BuildingsCacheEntry | null {
  const cached = buildingsShardMemo.get(cell.name);
  if (cached !== undefined) return cached;
  const entry = readJsonFile<BuildingsCacheEntry>(resolveShardPath(cell.buildings));
  buildingsShardMemo.set(cell.name, entry);
  return entry;
}

function appendMatching<T>(
  target: T[],
  source: T[] | undefined,
  matches: (item: T) => boolean,
): void {
  if (!source || source.length === 0) return;
  // push(...hugeArray) 는 인자 한도/콜스택을 터뜨리므로 루프로 추가한다.
  for (let i = 0; i < source.length; i += 1) {
    const item = source[i];
    if (matches(item)) target.push(item);
  }
}

function collectRoadsFromEntries(matching: RoadsCacheEntry[], bbox: Bbox): RoadsData | null {
  if (matching.length === 0) return null;

  const walkLines: WalkLine[] = [];
  const subwayLines: WalkLine[] = [];
  const stationPolygons: LatLng[][] = [];
  const walkPolygons: LatLng[][] = [];
  const apartmentPolygons: LatLng[][] = [];

  for (const entry of matching) {
    appendMatching(walkLines, entry.roads.walkLines, (line) => lineIntersectsBbox(line, bbox));
    appendMatching(subwayLines, entry.roads.subwayLines, (line) => lineIntersectsBbox(line, bbox));
    appendMatching(stationPolygons, entry.roads.stationPolygons, (poly) =>
      polygonIntersectsBbox(poly, bbox),
    );
    appendMatching(walkPolygons, entry.roads.walkPolygons, (poly) =>
      polygonIntersectsBbox(poly, bbox),
    );
    appendMatching(apartmentPolygons, entry.roads.apartmentPolygons, (poly) =>
      polygonIntersectsBbox(poly, bbox),
    );
  }

  if (walkLines.length === 0 && walkPolygons.length === 0) return null;

  return {
    walkLines: dedupeLines(walkLines),
    subwayLines: dedupeLines(subwayLines),
    stationPolygons: dedupePolygons(stationPolygons),
    walkPolygons: dedupePolygons(walkPolygons),
    apartmentPolygons: dedupePolygons(apartmentPolygons),
    blockPolygons: [],
    buildingCoverage: matching
      .map((entry) => entry.bbox)
      .filter((entryBbox) => bboxContains(entryBbox, bbox) || bboxIntersects(entryBbox, bbox)),
  };
}

export function getCachedRoads(bbox: Bbox): RoadsData | null {
  const index = getShardIndex();
  if (index?.cells?.length) {
    const matchingCells = index.cells.filter((cell) => bboxIntersects(cellToBbox(cell), bbox));
    const matching = matchingCells
      .map((cell) => loadRoadsShard(cell))
      .filter((entry): entry is RoadsCacheEntry => Boolean(entry));
    const fromShards = collectRoadsFromEntries(matching, bbox);
    if (fromShards) return fromShards;
  }

  const entries = getRoadsCache()?.entries ?? [];
  const matching = entries.filter((entry) => bboxIntersects(entry.bbox, bbox));
  return collectRoadsFromEntries(matching, bbox);
}

export function getCachedBuildings(bbox: Bbox): LatLng[][] | null {
  const index = getShardIndex();
  if (index?.cells?.length) {
    const matchingCells = index.cells.filter((cell) => bboxIntersects(cellToBbox(cell), bbox));
    const polygons: LatLng[][] = [];
    for (const cell of matchingCells) {
      const entry = loadBuildingsShard(cell);
      if (!entry) continue;
      appendMatching(polygons, entry.blockPolygons, (poly) =>
        polygonIntersectsBbox(poly, bbox),
      );
    }
    const deduped = dedupePolygons(polygons);
    if (deduped.length > 0) return deduped;
  }

  const entries = getBuildingsCache()?.entries ?? [];
  const matching = entries.filter((entry) => bboxIntersects(entry.bbox, bbox));
  if (matching.length === 0) return null;

  const polygons: LatLng[][] = [];
  for (const entry of matching) {
    appendMatching(polygons, entry.blockPolygons, (poly) =>
      polygonIntersectsBbox(poly, bbox),
    );
  }
  const deduped = dedupePolygons(polygons);
  return deduped.length > 0 ? deduped : null;
}
