import { NextRequest, NextResponse } from "next/server";
import { isVworldConfigured } from "@/lib/vworld/config";
import { fetchVworldTilePng } from "@/lib/vworld/tiles";

export const dynamic = "force-dynamic";

const OSM_TILE = "https://tile.openstreetmap.org";

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
    const hybrid = await fetchVworldTilePng(zi, xi, yi, "Hybrid");
    if (hybrid) {
      return new NextResponse(hybrid, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const base = await fetchVworldTilePng(zi, xi, yi, "Base");
    if (base) {
      return new NextResponse(base, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  const fallback = await fetch(`${OSM_TILE}/${zi}/${xi}/${yi}.png`, {
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
