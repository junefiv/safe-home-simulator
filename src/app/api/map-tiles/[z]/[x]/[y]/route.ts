import { NextRequest, NextResponse } from "next/server";
import { isVworldConfigured } from "@/lib/vworld/config";
import {
  fetchVworldTilePng,
  fetchVworldWmtsTilePng,
} from "@/lib/vworld/tiles";

export const dynamic = "force-dynamic";

const OSM_TILE = "https://tile.openstreetmap.org";
/** VWorld WMTS/WMS는 줌 19 초과 타일 미지원 */
const VWORLD_MAX_ZOOM = 19;

function clampTileForVworld(z: number, x: number, y: number) {
  if (z <= VWORLD_MAX_ZOOM) return { z, x, y };
  const shift = z - VWORLD_MAX_ZOOM;
  return { z: VWORLD_MAX_ZOOM, x: x >> shift, y: y >> shift };
}

const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Cache-Control": "public, max-age=86400",
} as const;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await context.params;
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y.replace(/\.png$/, ""));

  if (!Number.isFinite(zi) || !Number.isFinite(xi) || !Number.isFinite(yi)) {
    return NextResponse.json({ error: "invalid tile" }, { status: 400 });
  }

  if (isVworldConfigured()) {
    const tile = clampTileForVworld(zi, xi, yi);

    // 1) 배경지도 WMTS — 국토교통부 최신 기본지도
    const base = await fetchVworldWmtsTilePng(tile.z, tile.x, tile.y, "Base");
    if (base) {
      return new NextResponse(base, { headers: PNG_HEADERS });
    }

    // 2) WMS Hybrid — 항공+도로 합성
    const hybrid = await fetchVworldTilePng(tile.z, tile.x, tile.y, "Hybrid");
    if (hybrid) {
      return new NextResponse(hybrid, { headers: PNG_HEADERS });
    }

    const wmsBase = await fetchVworldTilePng(tile.z, tile.x, tile.y, "Base");
    if (wmsBase) {
      return new NextResponse(wmsBase, { headers: PNG_HEADERS });
    }
  }

  const osmZ = Math.min(zi, 19);
  const osmShift = zi - osmZ;
  const osmX = osmShift > 0 ? xi >> osmShift : xi;
  const osmY = osmShift > 0 ? yi >> osmShift : yi;

  const fallback = await fetch(`${OSM_TILE}/${osmZ}/${osmX}/${osmY}.png`, {
    headers: { "User-Agent": "SafeHomeSimulator/1.0" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!fallback.ok) {
    return NextResponse.json({ error: "tile unavailable" }, { status: 502 });
  }

  const bytes = await fallback.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
