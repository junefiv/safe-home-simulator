import type { LatLng, NormalizedFacility, WalkLine } from "./types";
import { haversineDistance } from "./geo";
import { getNearestValidPoint } from "./roadValidation";

export type LoadingPhase = "init" | "roads" | "facilities" | "buildings" | "ready";

export interface FacilityCounts {
  light: number;
  cctv: number;
  police: number;
  bell: number;
  store: number;
}

export const GAME_TIPS = [
  "파출소·지구대 반경 안에 들어가면 좀비가 도망칩니다.",
  "편의점에서 에너지 드링크를 채우면 잠시 더 빨리 달릴 수 있어요.",
  "보안등 밝은 곳에서는 좀비가 조금 느려집니다.",
  "CCTV 근처에 있으면 좀비가 잠시 멈출 수 있습니다.",
  "안심벨을 누르면 주변 좀비가 잠시 기절합니다.",
  "큰 도로를 따라가면 건물에 끼일 일이 적습니다.",
  "좁은 골목은 건물 사이를 지나가야 할 때가 있습니다.",
] as const;

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
  const safety =
    counts.police * 3 +
    counts.bell * 0.4 +
    counts.cctv * 0.05 +
    counts.light * 0.01;

  if (distanceM > 2500 && safety < 8) {
    return "거리가 깁니다. 큰 도로와 밝은 길을 우선하세요.";
  }
  if (counts.police >= 3) {
    return "지구대·파출소가 많은 구간입니다. 위급 시 가까운 곳으로 피하세요.";
  }
  if (counts.light < 30 && distanceM > 1200) {
    return "어두운 구간이 있습니다. 보안등 있는 길을 찾아가세요.";
  }
  return "큰 도로 위주로 이동하면 안전합니다.";
}

/** 로딩 중 단조 증가용 난이도(0–100) */
export function computeLiveDifficulty(
  phase: LoadingPhase,
  distanceM: number,
  animatedCounts: FacilityCounts,
  elapsedMs: number,
): number {
  const phaseFloor: Record<LoadingPhase, number> = {
    init: 5,
    roads: 18,
    facilities: 38,
    buildings: 62,
    ready: 78,
  };

  const tick = Math.min(22, (elapsedMs / 1000) * 4);
  let score = phaseFloor[phase] + tick;
  score += Math.min(distanceM / 180, 14);

  if (animatedCounts.light > 0) score += 6 * Math.min(1, animatedCounts.light / 80);
  if (animatedCounts.cctv > 0) score += 5 * Math.min(1, animatedCounts.cctv / 40);
  if (animatedCounts.police > 0) score += 7 * Math.min(1, animatedCounts.police / 5);
  if (animatedCounts.bell > 0) score += 5 * Math.min(1, animatedCounts.bell / 10);
  if (animatedCounts.store > 0) score += 4 * Math.min(1, animatedCounts.store / 15);

  return Math.min(100, Math.round(score));
}

/** 브리핑 완료 후 최종 난이도 */
export function computeFinalDifficulty(
  distanceM: number,
  counts: FacilityCounts,
): number {
  const distanceScore = Math.min(distanceM / 90, 38);
  const safety =
    counts.police * 3.5 +
    counts.bell * 0.35 +
    counts.cctv * 0.06 +
    counts.light * 0.012 +
    counts.store * 0.08;
  return Math.round(
    Math.min(100, Math.max(12, distanceScore + 42 - Math.min(safety, 36))),
  );
}

export function difficultyLabel(score: number): string {
  if (score < 30) return "여유";
  if (score < 50) return "보통";
  if (score < 70) return "주의";
  return "위험";
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
  facilities: NormalizedFacility[],
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  let minLat = Math.min(start.lat, end.lat);
  let maxLat = Math.max(start.lat, end.lat);
  let minLng = Math.min(start.lng, end.lng);
  let maxLng = Math.max(start.lng, end.lng);

  for (const f of facilities) {
    minLat = Math.min(minLat, f.lat);
    maxLat = Math.max(maxLat, f.lat);
    minLng = Math.min(minLng, f.lng);
    maxLng = Math.max(maxLng, f.lng);
  }

  const latPad = Math.max((maxLat - minLat) * 0.18, 0.004);
  const lngPad = Math.max((maxLng - minLng) * 0.18, 0.005);
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
