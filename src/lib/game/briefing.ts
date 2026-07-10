import type { Bbox, FacilityType, LatLng, NormalizedFacility, WalkLine } from "./types";
import { distancePointToRouteM, haversineDistance, offsetByMeters } from "./geo";
import { getNearestValidPoint } from "./roadValidation";
import {
  ROUTE_CORRIDOR_FETCH_PADDING_M,
  ROUTE_CORRIDOR_RADIUS_M,
} from "./constants";

export type LoadingPhase = "init" | "roads" | "facilities" | "buildings" | "ready";

export interface FacilityCounts {
  light: number;
  cctv: number;
  police: number;
  bell: number;
  store: number;
}

/** 시설점수 가중치 (가로등 제외) */
export const FACILITY_SCORE_WEIGHTS = {
  police: 4.2,
  bell: 1.9,
  store: 1.25,
  cctv: 0.85,
} as const;

const MIN_DISTANCE_KM = 0.1;
/** 안전점수 바 표시 — 35점 이상이면 100% */
export const SAFETY_BAR_MAX = 35;

export const FACILITY_GIMMICKS: {
  key: keyof FacilityCounts;
  emoji: string;
  label: string;
  text: string;
}[] = [
  {
    key: "light",
    emoji: "💡",
    label: "가로등",
    text: "반경 5m — 좀비 이동속도 90%. 패시브, 직접 조작 없음.",
  },
  {
    key: "police",
    emoji: "🚓",
    label: "지구대·파출소",
    text: "반경 8m 진입 시 HP+1·안전구역. 좀비 공격 면역, 좀비는 경찰서로 도망.",
  },
  {
    key: "bell",
    emoji: "🔔",
    label: "귀가안심벨",
    text: "4m 이내 자동 발동 → 5초 후 전 좀비 3초 감전. 쿨다운 30초.",
  },
  {
    key: "cctv",
    emoji: "📹",
    label: "CCTV",
    text: "반경 10m — 좀비 3초간 추격 중단(멈춤). CCTV당 30초 쿨다운.",
  },
  {
    key: "store",
    emoji: "🏪",
    label: "편의점",
    text: "반경 8m에서 5초 머무르면 충전. 충전 중 좀비 정지, 완료 시 이동 1.2배 5초.",
  },
];

export const GAME_TIPS = [
  "파출소·지구대 안에서는 좀비에게 잡히지 않습니다.",
  "편의점에서 5초 머무르면 충전 중 좀비가 멈춥니다.",
  "보안등 밝은 곳에서는 좀비가 조금 느려집니다.",
  "CCTV 근처에 있으면 좀비가 잠시 멈출 수 있습니다.",
  "안심벨 근처 4m에서 5초 뒤 좀비가 3초간 감전됩니다.",
  "큰 도로를 따라가면 이동이 수월합니다.",
  "도로 밖으로 나가면 이동할 수 없습니다.",
] as const;

const COLOCATE_RADIUS_M = 18;
const COLOCATE_SPREAD_M = 5;

export function countFacilities(facilities: NormalizedFacility[]): FacilityCounts {
  const counts: FacilityCounts = {
    light: 0,
    cctv: 0,
    police: 0,
    bell: 0,
    store: 0,
  };
  for (const f of facilities) {
    if (f.type in counts) counts[f.type as keyof FacilityCounts] += 1;
  }
  return counts;
}

/** 경로 선 기준 corridor 이내 시설만 남긴다. */
export function filterFacilitiesAlongRoute(
  facilities: NormalizedFacility[],
  route: LatLng[],
  maxDistanceM = ROUTE_CORRIDOR_RADIUS_M,
): NormalizedFacility[] {
  if (route.length < 2) return facilities;
  return facilities.filter(
    (f) => distancePointToRouteM({ lat: f.lat, lng: f.lng }, route) <= maxDistanceM,
  );
}

/** 경로 주변 API 조회용 bbox */
export function bboxAlongRoute(route: LatLng[], paddingM = ROUTE_CORRIDOR_FETCH_PADDING_M): Bbox {
  if (route.length === 0) {
    return { south: 0, west: 0, north: 0, east: 0 };
  }

  let minLat = route[0].lat;
  let maxLat = route[0].lat;
  let minLng = route[0].lng;
  let maxLng = route[0].lng;
  for (const p of route) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const centerLat = (minLat + maxLat) / 2;
  const latPad = paddingM / 111111;
  const lngPad = paddingM / (111111 * Math.cos((centerLat * Math.PI) / 180));

  return {
    south: minLat - latPad,
    north: maxLat + latPad,
    west: minLng - lngPad,
    east: maxLng + lngPad,
  };
}

/** CCTV·비상벨 등 같은 좌표 마커를 좌우로 분리 */
export function layoutColocatedFacilityMarkers(
  facilities: NormalizedFacility[],
): NormalizedFacility[] {
  const groups: NormalizedFacility[][] = [];
  const used = new Set<string>();

  for (const facility of facilities) {
    if (used.has(facility.id)) continue;

    const group = [facility];
    used.add(facility.id);

    for (const other of facilities) {
      if (used.has(other.id)) continue;
      if (haversineDistance(facility, other) <= COLOCATE_RADIUS_M) {
        group.push(other);
        used.add(other.id);
      }
    }

    groups.push(group);
  }

  const out: NormalizedFacility[] = [];
  for (const group of groups) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    group.sort((a, b) => a.type.localeCompare(b.type));
    const center = group[0];
    const mid = (group.length - 1) / 2;

    for (let i = 0; i < group.length; i += 1) {
      const offsetEast = (i - mid) * COLOCATE_SPREAD_M;
      const shifted = offsetByMeters(center, 0, offsetEast);
      out.push({
        ...group[i],
        displayLat: shifted.lat,
        displayLng: shifted.lng,
      });
    }
  }

  return out;
}

function facilityScore(counts: FacilityCounts): number {
  return (
    counts.police * FACILITY_SCORE_WEIGHTS.police +
    counts.bell * FACILITY_SCORE_WEIGHTS.bell +
    counts.store * FACILITY_SCORE_WEIGHTS.store +
    counts.cctv * FACILITY_SCORE_WEIGHTS.cctv
  );
}

/** 거리점수 — km 단위 (2km → 2) */
export function distanceScoreKm(distanceM: number): number {
  return distanceM / 1000;
}

/** 안전점수 = 시설점수 ÷ 거리점수(km). 클수록 안전 */
export function computeSafetyScore(distanceM: number, counts: FacilityCounts): number {
  const distanceKm = Math.max(distanceScoreKm(distanceM), MIN_DISTANCE_KM);
  return facilityScore(counts) / distanceKm;
}

export function safetyLabel(score: number): string {
  if (score >= 25) return "안전";
  if (score >= 12) return "보통";
  if (score >= 5) return "주의";
  return "위험";
}

export function safetyBarPercent(score: number): number {
  return Math.min(100, Math.max(4, (score / SAFETY_BAR_MAX) * 100));
}

export function buildStraightRoute(start: LatLng, end: LatLng, segments = 1): LatLng[] {
  if (segments <= 1) return [start, end];
  const points: LatLng[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    points.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lng: start.lng + (end.lng - start.lng) * t,
    });
  }
  return points;
}

/** 직선 보간 후 도로 중심선에 스냅한 미리보기 경로 */
export function buildSnappedPreviewRoute(
  start: LatLng,
  end: LatLng,
  walkLines: WalkLine[],
): LatLng[] {
  if (walkLines.length === 0) return [start, end];

  const steps = 28;
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lat = start.lat + (end.lat - start.lat) * t;
    const lng = start.lng + (end.lng - start.lng) * t;
    points.push(getNearestValidPoint(lat, lng, walkLines));
  }

  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (
      !last ||
      Math.abs(last.lat - p.lat) > 1e-7 ||
      Math.abs(last.lng - p.lng) > 1e-7
    ) {
      out.push(p);
    }
  }
  return out.length >= 2 ? out : [start, end];
}

export function buildRecommendation(
  distanceM: number,
  counts: FacilityCounts,
): string {
  const safety = facilityScore(counts);

  if (distanceM > 2500 && safety < 8) {
    return "거리가 깁니다. 큰 도로와 밝은 길을 우선하세요.";
  }
  if (counts.police >= 2) {
    return "지구대·파출소가 경로 근처에 있습니다. 위급 시 가까운 곳으로 피하세요.";
  }
  if (counts.bell + counts.cctv < 2 && distanceM > 1500) {
    return "비상벨·CCTV가 적습니다. 큰 도로를 우선하세요.";
  }
  return "큰 도로 위주로 이동하면 안전합니다.";
}

export function projectToPreview(
  point: LatLng,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  width: number,
  height: number,
  padding: number,
): { x: number; y: number } {
  const latSpan = bounds.maxLat - bounds.minLat || 0.001;
  const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
  const x =
    padding +
    ((point.lng - bounds.minLng) / lngSpan) * (width - padding * 2);
  const y =
    padding +
    (1 - (point.lat - bounds.minLat) / latSpan) * (height - padding * 2);
  return { x, y };
}

export function previewBounds(
  start: LatLng,
  end: LatLng,
  route: LatLng[],
  facilities: NormalizedFacility[],
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const points = [start, end, ...route, ...facilities.map((f) => ({ lat: f.lat, lng: f.lng }))];
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const latPad = Math.max((maxLat - minLat) * 0.12, 0.003);
  const lngPad = Math.max((maxLng - minLng) * 0.12, 0.004);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

export function routeDistanceM(route: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += haversineDistance(route[i - 1], route[i]);
  }
  return total;
}

const PREVIEW_EMOJI: Record<string, string> = {
  police: "🚓",
  bell: "🔔",
  cctv: "📹",
  store: "🏪",
};

/** 미리보기 지도용 — 겹치는 마커는 SVG x 오프셋 */
export function previewMapMarkers(
  facilities: NormalizedFacility[],
): { id: string; lat: number; lng: number; emoji: string; xOffset: number }[] {
  const important = facilities.filter(
    (f) => f.type === "police" || f.type === "bell" || f.type === "cctv" || f.type === "store",
  );

  const groups: NormalizedFacility[][] = [];
  const used = new Set<string>();

  for (const f of important) {
    if (used.has(f.id)) continue;
    const group = [f];
    used.add(f.id);
    for (const other of important) {
      if (used.has(other.id)) continue;
      if (haversineDistance(f, other) <= COLOCATE_RADIUS_M) {
        group.push(other);
        used.add(other.id);
      }
    }
    groups.push(group);
  }

  const markers: { id: string; lat: number; lng: number; emoji: string; xOffset: number }[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.type.localeCompare(b.type));
    const mid = (group.length - 1) / 2;
    for (let i = 0; i < group.length; i += 1) {
      const f = group[i];
      markers.push({
        id: f.id,
        lat: f.displayLat ?? f.lat,
        lng: f.displayLng ?? f.lng,
        emoji: PREVIEW_EMOJI[f.type] ?? "📍",
        xOffset: (i - mid) * 9,
      });
    }
  }

  return markers.slice(0, 60);
}
