import { NextRequest, NextResponse } from "next/server";
import { isVworldConfigured } from "@/lib/vworld/config";
import {
  fetchVworldTilePng,
  fetchVworldWmtsTilePng,
} from "@/lib/vworld/tiles";

export const dynamic = "force-dynamic";

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

  if (!isVworldConfigured()) {
    return NextResponse.json(
      { error: "VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 502 },
    );
  }

  const tile = clampTileForVworld(zi, xi, yi);

  const base = await fetchVworldWmtsTilePng(tile.z, tile.x, tile.y, "Base");
  if (base) {
    return new NextResponse(base, { headers: PNG_HEADERS });
  }

  const hybrid = await fetchVworldTilePng(tile.z, tile.x, tile.y, "Hybrid");
  if (hybrid) {
    return new NextResponse(hybrid, { headers: PNG_HEADERS });
  }

  const wmsBase = await fetchVworldTilePng(tile.z, tile.x, tile.y, "Base");
  if (wmsBase) {
    return new NextResponse(wmsBase, { headers: PNG_HEADERS });
  }

  return NextResponse.json({ error: "VWorld tile unavailable" }, { status: 502 });
}
