import type { NormalizedFacility } from "../types";
import { parseCoordinate } from "../coord";

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.data,
    obj.response,
    (obj.response as Record<string, unknown>)?.body,
    (obj.response as Record<string, unknown>)?.items,
    obj.items,
    obj.records,
    obj.row,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[];
    if (c && typeof c === "object") {
      const inner = c as Record<string, unknown>;
      if (Array.isArray(inner.item)) return inner.item as Record<string, unknown>[];
      if (Array.isArray(inner.items)) return inner.items as Record<string, unknown>[];
      if (Array.isArray(inner.row)) return inner.row as Record<string, unknown>[];
    }
  }
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  return [];
}

export async function fetchBellFacilities(
  serviceKey: string,
  apiUrl?: string,
): Promise<NormalizedFacility[]> {
  if (!apiUrl) return [];

  const url = new URL(apiUrl);
  if (!url.searchParams.has("serviceKey") && serviceKey) {
    url.searchParams.set("serviceKey", serviceKey);
  }
  url.searchParams.set("type", url.searchParams.get("type") ?? "json");
  url.searchParams.set("numOfRows", url.searchParams.get("numOfRows") ?? "1000");
  url.searchParams.set("pageNo", url.searchParams.get("pageNo") ?? "1");

  const res = await fetch(url.toString(), { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Bell API error: ${res.status}`);
  const data = await res.json();
  const records = extractRecords(data);

  const facilities: NormalizedFacility[] = [];
  records.forEach((record, index) => {
    const coord = parseCoordinate(record);
    if (!coord) return;
    facilities.push({
      id: String(record.id ?? record.fcltId ?? `bell-${index}`),
      type: "bell",
      lat: coord.lat,
      lng: coord.lng,
      name: String(record.fcltNm ?? record.name ?? record.시설명 ?? "안심벨"),
      address: String(record.ronaAddr ?? record.address ?? record.도로명주소 ?? ""),
    });
  });

  return facilities;
}