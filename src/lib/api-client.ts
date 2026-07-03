import type { Bbox, GeocodeResult, NormalizedFacility, RoadsData } from "@/lib/game/types";
import type { FacilitiesLoadReport } from "@/lib/public-data/facilities-load-report";
import { logFacilitiesLoadReport } from "@/lib/public-data/facilities-load-report";

export async function fetchGeocode(query: string): Promise<GeocodeResult | null> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=1`);
  if (!res.ok) return null;
  const data = (await res.json()) as GeocodeResult[];
  return data[0] ?? null;
}

export async function fetchGeocodeSuggestions(
  query: string,
  limit = 5,
): Promise<GeocodeResult[]> {
  const res = await fetch(
    `/api/geocode?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  if (!res.ok) return [];
  return (await res.json()) as GeocodeResult[];
}

export async function fetchRoads(bbox: Bbox): Promise<RoadsData> {
  const params = new URLSearchParams({
    south: String(bbox.south),
    west: String(bbox.west),
    north: String(bbox.north),
    east: String(bbox.east),
  });
  const res = await fetch(`/api/roads?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "도로 데이터를 불러오지 못했습니다");
  }
  return (await res.json()) as RoadsData;
}

export interface FacilitiesFetchResult {
  facilities: NormalizedFacility[];
  loadReport?: FacilitiesLoadReport;
}

export async function fetchFacilities(bbox: Bbox): Promise<FacilitiesFetchResult> {
  const params = new URLSearchParams({
    south: String(bbox.south),
    west: String(bbox.west),
    north: String(bbox.north),
    east: String(bbox.east),
  });
  const res = await fetch(`/api/facilities?${params}`);
  if (!res.ok) throw new Error("Failed to load facilities");
  const data = (await res.json()) as {
    facilities: NormalizedFacility[];
    loadReport?: FacilitiesLoadReport;
    policeCount?: number;
    policeError?: string;
  };
  if ((data.policeCount ?? 0) === 0 && data.policeError) {
    throw new Error(data.policeError);
  }
  if (data.loadReport) {
    logFacilitiesLoadReport(data.loadReport);
  }
  return { facilities: data.facilities, loadReport: data.loadReport };
}
