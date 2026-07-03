import type { GeocodeResult } from "@/lib/game/types";
import {
  expandSidoPrefix,
  formatJibunAddressFromParts,
  formatRoadAddressFromParts,
  pickPlaceName,
  type NominatimAddressParts,
} from "@/lib/geocode/format-korean-address";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

const USER_AGENT = "SafeHomeSimulator/1.0 (educational project)";

interface NominatimRawItem {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddressParts;
}

interface KakaoDocument {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x: string;
  y: string;
}

function mapNominatimItem(item: NominatimRawItem): GeocodeResult {
  const parts = item.address ?? {};
  const roadAddress = formatRoadAddressFromParts(parts);
  const jibunAddress = formatJibunAddressFromParts(parts);
  const name = pickPlaceName(item.name, parts);

  return {
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    name,
    roadAddress,
    jibunAddress,
    displayName: item.display_name,
  };
}

function mapKakaoDocument(doc: KakaoDocument): GeocodeResult {
  const roadAddress = doc.road_address_name
    ? expandSidoPrefix(doc.road_address_name)
    : undefined;
  const jibunAddress = doc.address_name
    ? expandSidoPrefix(doc.address_name)
    : undefined;

  return {
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    name: doc.place_name?.trim() || undefined,
    roadAddress,
    jibunAddress,
    displayName: roadAddress ?? jibunAddress,
  };
}

function dedupeResults(items: GeocodeResult[], limit: number): GeocodeResult[] {
  const seen = new Set<string>();
  const out: GeocodeResult[] = [];

  for (const item of items) {
    const key = `${item.lat.toFixed(6)}:${item.lng.toFixed(6)}:${item.name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}

async function searchKakao(query: string, limit: number): Promise<GeocodeResult[]> {
  const apiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) return [];

  const headers = { Authorization: `KakaoAK ${apiKey}` };
  const encoded = encodeURIComponent(query);

  const [keywordRes, addressRes] = await Promise.all([
    fetch(`${KAKAO_KEYWORD_URL}?query=${encoded}&size=${limit}`, { headers }),
    fetch(`${KAKAO_ADDRESS_URL}?query=${encoded}&size=${limit}`, { headers }),
  ]);

  const documents: KakaoDocument[] = [];

  if (keywordRes.ok) {
    const data = (await keywordRes.json()) as { documents?: KakaoDocument[] };
    documents.push(...(data.documents ?? []));
  }
  if (addressRes.ok) {
    const data = (await addressRes.json()) as { documents?: KakaoDocument[] };
    documents.push(...(data.documents ?? []));
  }

  return dedupeResults(documents.map(mapKakaoDocument), limit);
}

async function searchNominatim(query: string, limit: number): Promise<GeocodeResult[]> {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", "ko");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 },
  });

  if (!res.ok) return [];

  const raw = (await res.json()) as NominatimRawItem[];
  return raw.map(mapNominatimItem);
}

export async function searchGeocode(query: string, limit: number): Promise<GeocodeResult[]> {
  const kakaoResults = await searchKakao(query, limit);
  if (kakaoResults.length > 0) return kakaoResults;

  return searchNominatim(query, limit);
}
