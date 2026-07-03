import type { LatLng } from "@/lib/game/types";

const VWORLD_ADDRESS_URL = "https://api.vworld.kr/req/address";

export type VworldAddressType = "road" | "parcel";

interface VworldPoint {
  x: string;
  y: string;
}

interface VworldAddressResponse {
  response?: {
    status?: string;
    result?: {
      point?: VworldPoint;
    };
  };
}

/** 괄호·부가 설명 제거 (예: "… 248 (신당동, 신당파출소)") */
export function cleanAddressForGeocode(address: string): string {
  return address
    .trim()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^서울시\b/, "서울특별시")
    .replace(/^부산시\b/, "부산광역시")
    .replace(/^대구시\b/, "대구광역시")
    .replace(/^인천시\b/, "인천광역시")
    .replace(/^광주시\b/, "광주광역시")
    .replace(/^대전시\b/, "대전광역시")
    .replace(/^울산시\b/, "울산광역시");
}

async function requestVworldCoord(
  address: string,
  type: VworldAddressType,
  apiKey: string,
): Promise<LatLng | null> {
  const url = new URL(VWORLD_ADDRESS_URL);
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getCoord");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("address", address);
  url.searchParams.set("type", type);
  url.searchParams.set("format", "json");
  url.searchParams.set("errorFormat", "json");
  url.searchParams.set("key", apiKey);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;

      const json = (await res.json()) as VworldAddressResponse;
      if (json.response?.status !== "OK") return null;

      const point = json.response.result?.point;
      if (!point) return null;

      const lat = parseFloat(point.y);
      const lng = parseFloat(point.x);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

      return { lat, lng };
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }

  return null;
}

/** Vworld Geocoder 2.0 — 도로명 우선, 실패 시 지번 재시도 */
export async function geocodeWithVworld(
  rawAddress: string,
  apiKey: string,
): Promise<LatLng | null> {
  const address = cleanAddressForGeocode(rawAddress);
  if (!address) return null;

  const road = await requestVworldCoord(address, "road", apiKey);
  if (road) return road;

  return requestVworldCoord(address, "parcel", apiKey);
}
