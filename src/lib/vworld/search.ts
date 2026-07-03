import type { GeocodeResult } from "@/lib/game/types";
import { expandSidoPrefix } from "@/lib/geocode/format-korean-address";
import { resolveVworldApiKey } from "./config";

const VWORLD_SEARCH_URL = "https://api.vworld.kr/req/search";

interface VworldSearchItem {
  title?: string;
  address?: {
    road?: string;
    parcel?: string;
    bldnm?: string;
  };
  point?: { x?: string; y?: string };
}

interface VworldSearchResponse {
  response?: {
    status?: string;
    result?: { items?: VworldSearchItem[] };
  };
}

function mapSearchItem(item: VworldSearchItem): GeocodeResult | null {
  const lat = parseFloat(item.point?.y ?? "");
  const lng = parseFloat(item.point?.x ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const roadRaw = item.address?.road?.trim();
  const parcelRaw = item.address?.parcel?.trim();
  const roadAddress = roadRaw ? expandSidoPrefix(roadRaw) : undefined;
  const jibunAddress = parcelRaw ? expandSidoPrefix(parcelRaw) : undefined;
  const name = item.title?.trim() || item.address?.bldnm?.trim() || undefined;

  return {
    lat,
    lng,
    name,
    roadAddress,
    jibunAddress,
    displayName: roadAddress ?? jibunAddress ?? name,
  };
}

async function searchVworldCategory(
  query: string,
  category: "road" | "parcel",
  limit: number,
  apiKey: string,
): Promise<GeocodeResult[]> {
  const url = new URL(VWORLD_SEARCH_URL);
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("type", "address");
  url.searchParams.set("category", category);
  url.searchParams.set("format", "json");
  url.searchParams.set("errorFormat", "json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("query", query.replace(/\s+/g, ""));
  url.searchParams.set("size", String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) return [];

  const json = (await res.json()) as VworldSearchResponse;
  if (json.response?.status !== "OK") return [];

  return (json.response.result?.items ?? [])
    .map(mapSearchItem)
    .filter((r): r is GeocodeResult => r !== null);
}

/** VWorld 검색 API 2.0 — 도로명·지번 주소 */
export async function searchGeocodeWithVworld(
  query: string,
  limit: number,
): Promise<GeocodeResult[]> {
  const apiKey = resolveVworldApiKey();
  if (!apiKey) return [];

  const [road, parcel] = await Promise.all([
    searchVworldCategory(query, "road", limit, apiKey),
    searchVworldCategory(query, "parcel", limit, apiKey),
  ]);

  const seen = new Set<string>();
  const out: GeocodeResult[] = [];

  for (const item of [...road, ...parcel]) {
    const key = `${item.lat.toFixed(6)}:${item.lng.toFixed(6)}:${item.roadAddress ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}
