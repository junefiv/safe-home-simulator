import { NextRequest, NextResponse } from "next/server";
import { mergePolygonLists } from "@/lib/game/buildingMerge";
import type { Bbox, LatLng } from "@/lib/game/types";
import { fetchVworldBuildings, VworldApiError } from "@/lib/vworld/buildings";
import { isVworldConfigured } from "@/lib/vworld/config";
import { getCachedBuildings } from "@/lib/server/map-cache";

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

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const cached = (() => {
    try {
      return getCachedBuildings(bbox);
    } catch (err) {
      console.error(
        "[buildings] map-cache 읽기 실패 → 실시간 API로 폴백:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  })();
  if (cached) {
    return NextResponse.json({
      blockPolygons: cached,
      count: cached.length,
      source: "cache",
      cached: true,
    });
  }

  if (!isVworldConfigured()) {
    return NextResponse.json(
      { error: "VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 502 },
    );
  }

  const sources: string[] = [];
  const errors: string[] = [];
  const chunks: LatLng[][][] = [];

  try {
    const vworld = await fetchVworldBuildings(bbox);
    if (vworld.length > 0) sources.push("vworld");
    chunks.push(vworld);
  } catch (err) {
    const msg = err instanceof VworldApiError ? err.message : "VWorld 실패";
    errors.push(msg);
    console.warn("[buildings] VWorld:", msg);
  }

  const blockPolygons = mergePolygonLists(...chunks);

  if (blockPolygons.length === 0 && errors.length > 0) {
    return NextResponse.json(
      { error: errors.join(" / "), vworldError: errors[0] },
      { status: 502 },
    );
  }

  return NextResponse.json({
    blockPolygons,
    count: blockPolygons.length,
    source: sources.join("+") || "none",
    errors: errors.length > 0 ? errors : undefined,
  });
}
