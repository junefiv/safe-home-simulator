import { NextRequest, NextResponse } from "next/server";
import { FACILITIES_CACHE_TTL_MS } from "@/lib/game/constants";
import type { Bbox, NormalizedFacility } from "@/lib/game/types";
import { fetchCctvFacilities } from "@/lib/public-data/adapters/cctv";
import { fetchBellFacilities } from "@/lib/public-data/adapters/bell";
import { fetchLightFacilities } from "@/lib/public-data/adapters/light";
import { fetchPoliceFacilities } from "@/lib/public-data/adapters/police";
import { ensureMinimumBbox, filterByBbox } from "@/lib/public-data/bbox-filter";
import {
  buildTypeLoadInfo,
  logFacilitiesLoadReport,
  type FacilitiesLoadReport,
} from "@/lib/public-data/facilities-load-report";
import { generateMockFacilities } from "@/lib/public-data/mock";
import { resolveOdcloudServiceKey } from "@/lib/public-data/odcloud-key";

interface CacheEntry {
  expiresAt: number;
  facilities: NormalizedFacility[];
  report: FacilitiesLoadReport;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(bbox: Bbox): string {
  return [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((n) => n.toFixed(5))
    .join(",");
}

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const south = searchParams.get("south");
  const west = searchParams.get("west");
  const north = searchParams.get("north");
  const east = searchParams.get("east");
  if (!south || !west || !north || !east) return null;
  return {
    south: parseFloat(south),
    west: parseFloat(west),
    north: parseFloat(north),
    east: parseFloat(east),
  };
}

function resolveOdcloudServiceKeyFromEnv(): string {
  return resolveOdcloudServiceKey();
}

const BUILD_HINT = "npm run build:safemap-facilities 로 전국 데이터를 생성하세요.";

export async function GET(request: NextRequest) {
  const bbox = parseBbox(request.nextUrl.searchParams);
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const gameBbox = ensureMinimumBbox(bbox);

  const key = cacheKey(gameBbox);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    logFacilitiesLoadReport({ ...cached.report, cached: true });
    return NextResponse.json({
      facilities: cached.facilities,
      loadReport: cached.report,
      cached: true,
    });
  }

  const useMock = process.env.USE_MOCK_FACILITIES === "true";
  const odcloudKey = resolveOdcloudServiceKey();

  let bellFacilities: NormalizedFacility[] = [];
  let bellError: string | undefined;
  let bellSource = "none";
  let bellIsMock = false;

  const nationwideLights = await fetchLightFacilities();
  const nationwideCctv = await fetchCctvFacilities();
  let lightError: string | undefined;
  let cctvError: string | undefined;
  const lightSource =
    nationwideLights.length > 0 ? "bundled-json" : "empty";
  const cctvSource = nationwideCctv.length > 0 ? "bundled-json" : "empty";

  if (nationwideLights.length === 0) {
    lightError = `security-lights.json 비어 있음. ${BUILD_HINT}`;
  }
  if (nationwideCctv.length === 0) {
    cctvError = `cctv-stations.json 비어 있음 (CCTV 레이어 미배포 가능). ${BUILD_HINT}`;
  }

  if (useMock) {
    const mock = generateMockFacilities(gameBbox);
    bellFacilities = mock.filter((f) => f.type === "bell");
    bellSource = "mock";
    bellIsMock = true;
  } else {
    try {
      if (process.env.BELL_API_URL?.trim()) {
        bellFacilities = await fetchBellFacilities(odcloudKey, process.env.BELL_API_URL);
        bellSource = bellFacilities.length > 0 ? "api" : "none";
        if (bellFacilities.length === 0) bellError = "API 응답이 비어 있습니다.";
      } else {
        bellError = "BELL_API_URL 미설정";
      }
    } catch (err) {
      bellError = err instanceof Error ? err.message : "안심벨 로딩 실패";
    }
    bellFacilities = filterByBbox(bellFacilities, gameBbox);
  }

  let policeFacilities: NormalizedFacility[] = [];
  let policeError: string | undefined;
  let policeSource = "none";
  const hasPoliceKeys =
    Boolean(resolveOdcloudServiceKeyFromEnv()) &&
    Boolean(process.env.VWORLD_API_KEY?.trim());

  if (hasPoliceKeys) {
    try {
      const policeResult = await fetchPoliceFacilities(odcloudKey, process.env.POLICE_API_URL);
      policeFacilities = policeResult.facilities;
      policeSource = policeResult.source;
      if (policeFacilities.length === 0) {
        policeError = "파출소 목록이 비어 있습니다. 키·캐시를 확인해주세요.";
      }
    } catch (err) {
      policeFacilities = [];
      policeError = err instanceof Error ? err.message : "파출소 로딩 실패";
    }
  } else if (!useMock) {
    policeError = "ODCLOUD_SERVICE_KEY 또는 VWORLD_API_KEY가 설정되지 않았습니다.";
  }

  const facilities = [
    ...bellFacilities,
    ...filterByBbox(nationwideLights, gameBbox),
    ...filterByBbox(nationwideCctv, gameBbox),
    ...policeFacilities,
  ];

  const report: FacilitiesLoadReport = {
    useMockMode: useMock,
    cached: false,
    bbox: gameBbox,
    light: buildTypeLoadInfo(nationwideLights, gameBbox, lightSource, false, lightError),
    bell: buildTypeLoadInfo(bellFacilities, gameBbox, bellSource, bellIsMock, bellError),
    cctv: buildTypeLoadInfo(nationwideCctv, gameBbox, cctvSource, false, cctvError),
    police: buildTypeLoadInfo(policeFacilities, gameBbox, policeSource, false, policeError),
  };

  logFacilitiesLoadReport(report);

  cache.set(key, {
    facilities,
    report,
    expiresAt: Date.now() + FACILITIES_CACHE_TTL_MS,
  });

  return NextResponse.json({
    facilities,
    loadReport: report,
    cached: false,
    policeCount: policeFacilities.length,
    lightCount: nationwideLights.length,
    cctvCount: nationwideCctv.length,
    policeError,
    lightError,
    bellError,
    cctvError,
  });
}
