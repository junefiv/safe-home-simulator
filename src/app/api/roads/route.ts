import { NextRequest, NextResponse } from "next/server";
import { bridgeRoadGaps } from "@/lib/game/roadValidation";
import { ROAD_JUNCTION_SLACK_M } from "@/lib/game/constants";
import type { Bbox, LatLng, RoadsData, WalkLine } from "@/lib/game/types";
import { getCachedRoads } from "@/lib/server/map-cache";
import { isVworldConfigured } from "@/lib/vworld/config";
import { VworldApiError } from "@/lib/vworld/data-client";
import { fetchVworldRoads } from "@/lib/vworld/roads";
import { fetchVworldStationZones } from "@/lib/vworld/stations";

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

function finalizeRoads(
  walkLines: WalkLine[],
  stationPolygons: LatLng[][],
): RoadsData {
  const bridged = bridgeRoadGaps(walkLines.map(widenNamedRoadLine));
  return {
    walkLines: bridged,
    subwayLines: [],
    stationPolygons,
    walkPolygons: stationPolygons,
    apartmentPolygons: [],
    blockPolygons: [],
    buildingCoverage: [],
  };
}

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  if (!isVworldConfigured()) {
    return NextResponse.json(
      { error: "VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 502 },
    );
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
    const roads = finalizeRoads(
      cached.walkLines,
      cached.stationPolygons ?? [],
    );
    return NextResponse.json({
      ...roads,
      source: "cache",
      walkLineCount: roads.walkLines.length,
      cached: true,
    });
  }

  try {
    const [walkLines, stationPolygons] = await Promise.all([
      fetchVworldRoads(bbox),
      fetchVworldStationZones(bbox).catch((err) => {
        console.warn(
          "[roads] VWorld station zones failed:",
          err instanceof Error ? err.message : err,
        );
        return [] as LatLng[][];
      }),
    ]);

    if (walkLines.length === 0) {
      return NextResponse.json(
        { error: "VWorld 도로중심선 데이터가 비어 있습니다." },
        { status: 502 },
      );
    }

    const roads = finalizeRoads(walkLines, stationPolygons);
    return NextResponse.json({
      ...roads,
      source: "vworld",
      walkLineCount: roads.walkLines.length,
      stationCount: stationPolygons.length,
    });
  } catch (err) {
    const message =
      err instanceof VworldApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Roads fetch failed";
    console.error("[roads] VWorld failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
