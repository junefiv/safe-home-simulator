import type { GeocodeResult } from "@/lib/game/types";
import { expandSidoPrefix } from "@/lib/geocode/format-korean-address";
import { searchGeocodeWithVworld } from "@/lib/vworld/search";

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

interface KakaoDocument {
  place_name?: string;
  address_name?: string;
  road_address_name?: string;
  x: string;
  y: string;
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

export async function searchGeocode(query: string, limit: number): Promise<GeocodeResult[]> {
  const vworldResults = await searchGeocodeWithVworld(query, limit);
  if (vworldResults.length > 0) return vworldResults;

  return searchKakao(query, limit);
}
