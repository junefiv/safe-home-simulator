import { NextRequest, NextResponse } from "next/server";
import { mergePolygonLists } from "@/lib/game/buildingMerge";
import { parseOverpassBuildings } from "@/lib/game/roadValidation";
import type { Bbox, LatLng } from "@/lib/game/types";
import {
  buildBuildingsOverpassQuery,
  fetchOverpassJson,
} from "@/lib/game/overpass-client";
import { fetchVworldBuildings, VworldApiError } from "@/lib/vworld/buildings";
import { isVworldConfigured } from "@/lib/vworld/config";

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

async function fetchOverpassBuildings(bbox: Bbox): Promise<LatLng[][]> {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const data = await fetchOverpassJson(buildBuildingsOverpassQuery(bboxStr), 45_000);
  return parseOverpassBuildings(
    (data.elements ?? []) as Parameters<typeof parseOverpassBuildings>[0],
  );
}

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const sources: string[] = [];
  const errors: string[] = [];
  const chunks: LatLng[][][] = [];

  if (isVworldConfigured()) {
    try {
      const vworld = await fetchVworldBuildings(bbox);
      if (vworld.length > 0) sources.push("vworld");
      chunks.push(vworld);
    } catch (err) {
      const msg = err instanceof VworldApiError ? err.message : "VWorld 실패";
      errors.push(msg);
      console.warn("[buildings] VWorld:", msg);
    }
  }

  // VWorld가 결과를 주면 느린 Overpass를 기다리지 않는다. Overpass는 대체 소스로만 사용한다.
  if (chunks.every((chunk) => chunk.length === 0)) {
    try {
      const overpass = await fetchOverpassBuildings(bbox);
      if (overpass.length > 0) sources.push("overpass");
      chunks.push(overpass);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Overpass 실패";
      errors.push(msg);
      console.warn("[buildings] Overpass:", msg);
    }
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
