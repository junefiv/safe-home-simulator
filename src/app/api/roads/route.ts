import { NextRequest, NextResponse } from "next/server";
import { buildRoadsOverpassQuery, fetchOverpassJson } from "@/lib/game/overpass-client";
import { parseOverpassRoads } from "@/lib/game/roadValidation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const south = searchParams.get("south");
  const west = searchParams.get("west");
  const north = searchParams.get("north");
  const east = searchParams.get("east");

  if (!south || !west || !north || !east) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const bbox = `${south},${west},${north},${east}`;

  try {
    const data = await fetchOverpassJson(buildRoadsOverpassQuery(bbox));
    const roads = parseOverpassRoads(
      (data.elements ?? []) as Parameters<typeof parseOverpassRoads>[0],
    );
    return NextResponse.json(roads);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Roads fetch failed";
    console.error("[roads] Overpass failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
