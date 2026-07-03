import { unstable_cache } from "next/cache";
import { geocodeWithVworld } from "@/lib/geocode/vworld";
import type { LatLng, NormalizedFacility } from "@/lib/game/types";
import {
  POLICE_FETCH_PER_PAGE,
  POLICE_ODCLOUD_ENDPOINT,
} from "@/lib/public-data/police-constants";
import {
  readPoliceDailyCache,
  writePoliceDailyCache,
} from "@/lib/public-data/police-daily-cache";
import { resolveOdcloudServiceKey } from "@/lib/public-data/odcloud-key";
import bundledPolice from "@/data/police-stations.json";

interface PoliceApiRecord {
  연번?: number;
  시도청?: string;
  경찰서?: string;
  관서명?: string;
  구분?: string;
  주소?: string;
}

interface PoliceApiResponse {
  totalCount?: number;
  data?: PoliceApiRecord[];
}

const geocodeMemoryCache = new Map<string, LatLng>();
let memoryCache: NormalizedFacility[] | null = null;
let loadPromise: Promise<PoliceFetchResult> | null = null;
let lastPoliceSource: PoliceLoadSource = "none";

export type PoliceLoadSource =
  | "memory-cache"
  | "disk-cache"
  | "bundled-json"
  | "api-geocode"
  | "none";

export interface PoliceFetchResult {
  facilities: NormalizedFacility[];
  source: PoliceLoadSource;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveVworldApiKey(): string {
  return process.env.VWORLD_API_KEY?.trim() ?? "";
}

function buildOdcloudUrl(page: number, perPage: number, serviceKey: string): string {
  const url = new URL(POLICE_ODCLOUD_ENDPOINT);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  url.searchParams.set("serviceKey", serviceKey);
  return url.toString();
}

async function fetchAllPoliceRecords(serviceKey?: string): Promise<PoliceApiRecord[]> {
  const key = serviceKey ?? resolveOdcloudServiceKey();
  if (!key) throw new Error("ODCLOUD_SERVICE_KEY가 설정되지 않았습니다.");

  const records: PoliceApiRecord[] = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;

  while (records.length < totalCount) {
    const res = await fetch(buildOdcloudUrl(page, POLICE_FETCH_PER_PAGE, key));
    if (!res.ok) {
      throw new Error(`Police API error: ${res.status}`);
    }

    const json = (await res.json()) as PoliceApiResponse & { code?: number; msg?: string };
    if (json.code !== undefined && json.code < 0) {
      throw new Error(json.msg ?? `Police API error code ${json.code}`);
    }
    totalCount = json.totalCount ?? records.length;
    const pageData = json.data ?? [];
    if (pageData.length === 0) break;

    records.push(...pageData);
    page += 1;
  }

  return records;
}

async function geocodeAddress(
  address: string,
  vworldKey: string,
): Promise<LatLng | null> {
  const cached = geocodeMemoryCache.get(address);
  if (cached) return cached;

  const coord = await geocodeWithVworld(address, vworldKey);
  if (coord) geocodeMemoryCache.set(address, coord);
  return coord;
}

function recordToFacility(
  record: PoliceApiRecord,
  coord: LatLng,
  address: string,
): NormalizedFacility {
  const branch = record.관서명?.trim() ?? "관서";
  const kind = record.구분?.trim() ?? "";
  const station = record.경찰서?.trim();

  return {
    id: `police-${record.연번 ?? `${station}-${branch}`}`,
    type: "police",
    lat: coord.lat,
    lng: coord.lng,
    name: kind ? `${branch} ${kind}` : branch,
    address,
  };
}

async function buildPoliceFacilities(
  serviceKey?: string,
  vworldKey?: string,
): Promise<NormalizedFacility[]> {
  const odKey = serviceKey ?? resolveOdcloudServiceKey();
  const vwKey = vworldKey ?? resolveVworldApiKey();
  const records = await fetchAllPoliceRecords(odKey);
  const facilities: NormalizedFacility[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const address = record.주소?.trim();
    if (!address) continue;

    const coord = await geocodeAddress(address, vwKey);
    if (!coord) continue;

    facilities.push(recordToFacility(record, coord, address));

    // Vworld 일일 한도 여유 — 짧은 간격으로 순차 호출
    if (i % 10 === 9) await sleep(50);
  }

  return facilities;
}

async function loadPoliceFacilities(serviceKey: string): Promise<PoliceFetchResult> {
  if (memoryCache && memoryCache.length > 0) {
    lastPoliceSource = "memory-cache";
    return { facilities: memoryCache, source: lastPoliceSource };
  }

  const diskCache = await readPoliceDailyCache();
  if (diskCache && diskCache.facilities.length > 0) {
    memoryCache = diskCache.facilities;
    lastPoliceSource = "disk-cache";
    return { facilities: diskCache.facilities, source: lastPoliceSource };
  }

  if (Array.isArray(bundledPolice) && bundledPolice.length > 0) {
    memoryCache = bundledPolice as NormalizedFacility[];
    lastPoliceSource = "bundled-json";
    return { facilities: memoryCache, source: lastPoliceSource };
  }

  const vworldKey = resolveVworldApiKey();
  if (!serviceKey || !vworldKey) {
    lastPoliceSource = "none";
    return { facilities: [], source: lastPoliceSource };
  }

  const fetchAndGeocode = unstable_cache(
    async () => buildPoliceFacilities(serviceKey, vworldKey),
    ["police-stations-nationwide"],
    { revalidate: 86400 },
  );

  const facilities = await fetchAndGeocode();
  if (facilities.length > 0) {
    memoryCache = facilities;
    lastPoliceSource = "api-geocode";
    await writePoliceDailyCache(facilities).catch(() => {
      // 서버리스 환경 등 파일 쓰기 실패 시 무시
    });
  } else {
    lastPoliceSource = "none";
  }

  return { facilities, source: lastPoliceSource };
}

/** 전국 파출소·지구대 — 하루 1회 갱신 캐시 */
export async function fetchPoliceFacilities(
  serviceKey: string,
  _apiUrl?: string,
): Promise<PoliceFetchResult> {
  if (memoryCache && memoryCache.length > 0) {
    return { facilities: memoryCache, source: lastPoliceSource || "memory-cache" };
  }

  const diskCache = await readPoliceDailyCache();
  if (diskCache && diskCache.facilities.length > 0) {
    memoryCache = diskCache.facilities;
    lastPoliceSource = "disk-cache";
    return { facilities: diskCache.facilities, source: lastPoliceSource };
  }

  if (!loadPromise) {
    loadPromise = loadPoliceFacilities(serviceKey).finally(() => {
      loadPromise = null;
    });
  }

  return loadPromise;
}
