import { NextRequest, NextResponse } from "next/server";
import {
  bridgeRoadGaps,
  parseOverpassRoads,
  parseOverpassTransit,
} from "@/lib/game/roadValidation";
import { ROAD_JUNCTION_SLACK_M } from "@/lib/game/constants";
import {
  buildRoadsOverpassQuery,
  buildSubwayOverpassQuery,
  fetchOverpassJson,
  fetchOverpassJsonFast,
} from "@/lib/game/overpass-client";
import type { Bbox, LatLng, RoadsData, WalkLine } from "@/lib/game/types";
import { getCachedRoads } from "@/lib/server/map-cache";
import { fetchVworldRoads } from "@/lib/vworld/roads";
import { isVworldConfigured } from "@/lib/vworld/config";
import { VworldApiError } from "@/lib/vworld/data-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const south = Number(searchParams.get("south"));
  const west = Number(searchParams.get("west"));
  const north = Number(searchParams.get("north"));
  const east = Number(searchParams.get("east"));
  if ([south, west, north, east].some((v) => Number.isNaN(v))) return null;
  return { south, west, north, east };
}

function walkLineKey(line: WalkLine): string {
  return [
    line.p1.lat.toFixed(6),
    line.p1.lng.toFixed(6),
    line.p2.lat.toFixed(6),
    line.p2.lng.toFixed(6),
    Math.round(line.maxDistM),
    line.highway ?? "",
  ].join("|");
}

function mergeWalkLines(primary: WalkLine[], supplement: WalkLine[]): WalkLine[] {
  if (supplement.length === 0) return primary;
  const seen = new Set(primary.map(walkLineKey));
  const merged = [...primary];
  for (const line of supplement) {
    const key = walkLineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  return merged;
}

function mergePolygons(primary: LatLng[][], supplement: LatLng[][]): LatLng[][] {
  if (supplement.length === 0) return primary;
  const seen = new Set(
    primary.map((poly) =>
      `${poly[0]?.lat.toFixed(6)}|${poly[0]?.lng.toFixed(6)}|${poly.length}`,
    ),
  );
  const merged = [...primary];
  for (const poly of supplement) {
    if (poly.length < 3) continue;
    const key = `${poly[0].lat.toFixed(6)}|${poly[0].lng.toFixed(6)}|${poly.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(poly);
  }
  return merged;
}

function roadNameHalfWidthM(name?: string): number | null {
  if (!name) return null;
  if (/대로$/.test(name)) return 36;
  if (/로$/.test(name)) return 26;
  if (/길$/.test(name)) return 12;
  return null;
}

function widenNamedRoadLine(line: WalkLine): WalkLine {
  const namedWidth = roadNameHalfWidthM(line.highway);
  if (!namedWidth || line.maxDistM >= namedWidth) return line;

  const maxDistM = namedWidth;
  const pad = (maxDistM + ROAD_JUNCTION_SLACK_M) / 111111;
  return {
    ...line,
    maxDistM,
    minLat: Math.min(line.p1.lat, line.p2.lat) - pad,
    maxLat: Math.max(line.p1.lat, line.p2.lat) + pad,
    minLng: Math.min(line.p1.lng, line.p2.lng) - pad,
    maxLng: Math.max(line.p1.lng, line.p2.lng) + pad,
  };
}

function normalizeTransitAsWalkable(roads: RoadsData): RoadsData {
  const surfaceLines = roads.walkLines.map(widenNamedRoadLine);
  const walkLines = bridgeRoadGaps(
    mergeWalkLines(surfaceLines, roads.subwayLines ?? []),
  );
  const walkPolygons = mergePolygons(
    roads.walkPolygons ?? [],
    roads.stationPolygons ?? [],
  );

  return {
    ...roads,
    walkLines,
    walkPolygons,
  };
}

async function fetchOsmRoads(bbox: Bbox): Promise<RoadsData | null> {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  try {
    const data = await fetchOverpassJsonFast(buildRoadsOverpassQuery(bboxStr), 8_000);
    return parseOverpassRoads(
      (data.elements ?? []) as Parameters<typeof parseOverpassRoads>[0],
    );
  } catch (err) {
    console.warn(
      "[roads] OSM walkable road supplement failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function fetchTransitOnly(
  bbox: Bbox,
): Promise<Pick<RoadsData, "subwayLines" | "stationPolygons">> {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  try {
    const data = await fetchOverpassJson(buildSubwayOverpassQuery(bboxStr), 20_000);
    return parseOverpassTransit(
      (data.elements ?? []) as Parameters<typeof parseOverpassTransit>[0],
    );
  } catch (err) {
    console.warn(
      "[roads] Subway/station Overpass supplement failed:",
      err instanceof Error ? err.message : err,
    );
    return { subwayLines: [], stationPolygons: [] };
  }
}

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  let cached: ReturnType<typeof getCachedRoads> = null;
  try {
    cached = getCachedRoads(bbox);
  } catch (err) {
    console.error(
      "[roads] map-cache 읽기 실패 → 실시간 API로 폴백:",
      err instanceof Error ? err.message : err,
    );
  }
  if (cached) {
    const normalized = normalizeTransitAsWalkable(cached);
    return NextResponse.json({
      ...normalized,
      source: "cache",
      walkLineCount: normalized.walkLines.length,
      cached: true,
    });
  }

  let vworldLines: WalkLine[] = [];
  let vworldError: string | undefined;

  if (isVworldConfigured()) {
    try {
      vworldLines = await fetchVworldRoads(bbox);
    } catch (err) {
      vworldError =
        err instanceof VworldApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "VWorld roads fetch failed";
      console.warn("[roads] VWorld failed:", vworldError);
    }
  } else {
    vworldError = "VWORLD_API_KEY is not configured";
  }

  const osmRoads = await fetchOsmRoads(bbox);
  const transit = osmRoads
    ? {
        subwayLines: osmRoads.subwayLines,
        stationPolygons: osmRoads.stationPolygons,
      }
    : await fetchTransitOnly(bbox);

  const walkLines = bridgeRoadGaps(
    mergeWalkLines(vworldLines, osmRoads?.walkLines ?? []),
  );

  if (walkLines.length === 0) {
    return NextResponse.json(
      {
        error: vworldError ?? "No walkable road data found",
        osmSource: osmRoads ? "empty" : "failed",
      },
      { status: 502 },
    );
  }

  const stationPolygons = mergePolygons(
    transit.stationPolygons,
    osmRoads?.stationPolygons ?? [],
  );

  const roads = normalizeTransitAsWalkable({
    walkLines,
    subwayLines: transit.subwayLines,
    stationPolygons,
    walkPolygons: stationPolygons,
    apartmentPolygons: [],
    blockPolygons: [],
    buildingCoverage: [],
  });

  return NextResponse.json({
    ...roads,
    source:
      vworldLines.length > 0 && osmRoads
        ? "vworld+osm-walkable"
        : osmRoads
          ? "osm-walkable"
          : "vworld+transit",
    walkLineCount: walkLines.length,
    vworldError,
  });
}
