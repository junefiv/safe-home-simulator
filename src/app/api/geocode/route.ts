import { NextRequest, NextResponse } from "next/server";
import { searchGeocode } from "@/lib/geocode/providers";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  const limitParam = request.nextUrl.searchParams.get("limit") ?? "5";
  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 5, 1), 15);

  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchGeocode(q.trim(), limit);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Geocode error" }, { status: 500 });
  }
}
