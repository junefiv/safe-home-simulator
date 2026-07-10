import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bbox, LatLng, RoadsData, WalkLine } from "@/lib/game/types";

interface RoadsCacheEntry {
  bbox: Bbox;
  roads: RoadsData;
}

interface BuildingsCacheEntry {
  bbox: Bbox;
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

const CACHE_DIR = join(process.cwd(), ".cache");
const ROADS_CACHE_PATH = join(CACHE_DIR, "roads-cache.json");
const BUILDINGS_CACHE_PATH = join(CACHE_DIR, "buildings-cache.json");

let roadsCache: RoadsCacheFile | null | undefined;
let buildingsCache: BuildingsCacheFile | null | undefined;

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    console.warn("[map-cache] failed to read", path, err);
    return null;
  }
}

function getRoadsCache(): RoadsCacheFile | null {
  roadsCache ??= readJsonFile<RoadsCacheFile>(ROADS_CACHE_PATH);
  return roadsCache;
}

function getBuildingsCache(): BuildingsCacheFile | null {
  buildingsCache ??= readJsonFile<BuildingsCacheFile>(BUILDINGS_CACHE_PATH);
  return buildingsCache;
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

export function getCachedRoads(bbox: Bbox): RoadsData | null {
  const entries = getRoadsCache()?.entries ?? [];
  const matching = entries.filter((entry) => bboxIntersects(entry.bbox, bbox));
  if (matching.length === 0) return null;

  const walkLines: WalkLine[] = [];
  const subwayLines: WalkLine[] = [];
  const stationPolygons: LatLng[][] = [];
  const walkPolygons: LatLng[][] = [];
  const apartmentPolygons: LatLng[][] = [];

  for (const entry of matching) {
    walkLines.push(...entry.roads.walkLines.filter((line) => lineIntersectsBbox(line, bbox)));
    subwayLines.push(...(entry.roads.subwayLines ?? []).filter((line) => lineIntersectsBbox(line, bbox)));
    stationPolygons.push(...(entry.roads.stationPolygons ?? []).filter((poly) => polygonIntersectsBbox(poly, bbox)));
    walkPolygons.push(...(entry.roads.walkPolygons ?? []).filter((poly) => polygonIntersectsBbox(poly, bbox)));
    apartmentPolygons.push(...(entry.roads.apartmentPolygons ?? []).filter((poly) => polygonIntersectsBbox(poly, bbox)));
  }

  if (walkLines.length === 0 && walkPolygons.length === 0) return null;

  return {
    walkLines: dedupeLines(walkLines),
    subwayLines: dedupeLines(subwayLines),
    stationPolygons: dedupePolygons(stationPolygons),
    walkPolygons: dedupePolygons(walkPolygons),
    apartmentPolygons: dedupePolygons(apartmentPolygons),
    blockPolygons: [],
    buildingCoverage: matching.map((entry) => entry.bbox).filter((entryBbox) => bboxContains(entryBbox, bbox) || bboxIntersects(entryBbox, bbox)),
  };
}

export function getCachedBuildings(bbox: Bbox): LatLng[][] | null {
  const entries = getBuildingsCache()?.entries ?? [];
  const matching = entries.filter((entry) => bboxIntersects(entry.bbox, bbox));
  if (matching.length === 0) return null;

  const polygons = dedupePolygons(
    matching.flatMap((entry) =>
      entry.blockPolygons.filter((poly) => polygonIntersectsBbox(poly, bbox)),
    ),
  );
  return polygons.length > 0 ? polygons : null;
}
