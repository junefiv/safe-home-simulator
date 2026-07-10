import type { Bbox, NormalizedFacility } from "@/lib/game/types";

export interface FacilitySample {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

export interface FacilityTypeLoadInfo {
  /** api | mock | mock-fallback | bundled-json | disk-cache | api-geocode | none */
  source: string;
  isMock: boolean;
  count: number;
  inBbox: number;
  error?: string;
  samples: FacilitySample[];
}

export interface FacilitiesLoadReport {
  useMockMode: boolean;
  cached: boolean;
  bbox: Bbox;
  light: FacilityTypeLoadInfo;
  bell: FacilityTypeLoadInfo;
  cctv: FacilityTypeLoadInfo;
  police: FacilityTypeLoadInfo;
  store: FacilityTypeLoadInfo;
}

function isInBbox(f: NormalizedFacility, bbox: Bbox): boolean {
  return (
    f.lat >= bbox.south &&
    f.lat <= bbox.north &&
    f.lng >= bbox.west &&
    f.lng <= bbox.east
  );
}

function isMockFacility(f: NormalizedFacility): boolean {
  return f.id.startsWith("mock-");
}

export function sampleFacilities(
  facilities: NormalizedFacility[],
  limit = 3,
): FacilitySample[] {
  return facilities.slice(0, limit).map((f) => ({
    id: f.id,
    name: f.name ?? "(이름 없음)",
    lat: f.lat,
    lng: f.lng,
    address: f.address,
  }));
}

export function buildTypeLoadInfo(
  facilities: NormalizedFacility[],
  bbox: Bbox,
  source: string,
  isMock: boolean,
  error?: string,
): FacilityTypeLoadInfo {
  const inBboxList = facilities.filter((f) => isInBbox(f, bbox));
  return {
    source,
    isMock,
    count: facilities.length,
    inBbox: inBboxList.length,
    error,
    samples: sampleFacilities(inBboxList.length > 0 ? inBboxList : facilities),
  };
}

export function sourceLabel(info: FacilityTypeLoadInfo): string {
  if (info.isMock) return "임의 생성(mock)";
  const map: Record<string, string> = {
    api: "실제 API",
    "api-wfs": "생활안전지도 WFS (geoserver_pos)",
    "mock-fallback": "API 실패 → mock 대체",
    "bundled-json": "사전 빌드 JSON (전국 정적 데이터)",
    "disk-cache": "일일 디스크 캐시",
    "api-geocode": "경찰청 API + Vworld 지오코딩",
    none: "데이터 없음",
  };
  return map[info.source] ?? info.source;
}

export function logFacilitiesLoadReport(report: FacilitiesLoadReport): void {
  const header = report.cached ? "(캐시)" : "(신규 로드)";
  console.group(`[SafeHome] 시설물 로드 리포트 ${header}`);

  if (report.useMockMode) {
    console.warn("USE_MOCK_FACILITIES=true → 보안등·안심벨은 전부 mock입니다.");
  }

  const rows: [string, FacilityTypeLoadInfo][] = [
    ["💡 보안등", report.light],
    ["📹 CCTV", report.cctv],
    ["🔔 안심벨", report.bell],
    ["🚓 파출소/지구대", report.police],
  ];

  for (const [label, info] of rows) {
    const kind = info.isMock ? "⚠️ 임의값" : "✅ 실데이터";
    console.log(
      `${label} | ${kind} | 출처: ${sourceLabel(info)} | 전체 ${info.count}건 | bbox 내 ${info.inBbox}건`,
    );
    if (info.error) console.warn(`  └ 오류: ${info.error}`);
    if (info.samples.length > 0) {
      console.table(info.samples);
    } else {
      console.log("  └ 샘플 없음");
    }
  }

  console.groupEnd();
}
