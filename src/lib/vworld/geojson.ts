import type { LatLng, WalkLine } from "@/lib/game/types";
import {
  ROAD_JUNCTION_SLACK_M,
  ROAD_SEGMENT_TOLERANCE_M,
} from "@/lib/game/constants";

type Position = [number, number];
type Ring = Position[];
type LineCoords = Position[];
type MultiLineCoords = LineCoords[];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

interface GeoJsonGeometry {
  type?: string;
  coordinates?:
    | PolygonCoords
    | MultiPolygonCoords
    | LineCoords
    | MultiLineCoords
    | Position;
}

export interface GeoJsonFeature {
  geometry?: GeoJsonGeometry;
  properties?: Record<string, unknown>;
}

/** GeoJSON [lng, lat] → LatLng */
function ringToLatLng(ring: Ring): LatLng[] {
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

export function geometryToBlockPolygons(geometry: GeoJsonGeometry): LatLng[][] {
  if (!geometry.coordinates) return [];

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as PolygonCoords;
    const outer = rings[0];
    if (!outer || outer.length < 3) return [];
    return [ringToLatLng(outer)];
  }

  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as MultiPolygonCoords;
    const out: LatLng[][] = [];
    for (const poly of polys) {
      const outer = poly[0];
      if (outer && outer.length >= 3) out.push(ringToLatLng(outer));
    }
    return out;
  }

  return [];
}

/** 역사·지하철역 — 통과 허용 (건물 충돌 제외) */
export function isStationVworldBuilding(props?: Record<string, unknown>): boolean {
  if (!props) return false;
  const text = [
    props.main_purps_nm,
    props.etc_purps,
    props.bldg_nm,
    props.regstr_kind_nm,
  ]
    .filter(Boolean)
    .join(" ");
  return /지하철|철도|역사|환승|전철|역\b|station|subway/i.test(text);
}

/** VWorld 건축물 — 문화재·등록문화재 등은 통과 허용 */
export function isHistoricVworldBuilding(props?: Record<string, unknown>): boolean {
  if (!props) return false;
  const text = [
    props.main_purps_nm,
    props.etc_purps,
    props.regstr_kind_nm,
    props.regstr_kind_cd_nm,
    props.bldg_nm,
  ]
    .filter(Boolean)
    .join(" ");
  return /문화재|등록문화|사적|보물|국보|명승|유적|Historic/i.test(text);
}

function latLngPadForMeters(lat: number, meters: number): number {
  return meters / 111111;
}

function makeWalkLineSegment(
  p1: LatLng,
  p2: LatLng,
  maxDistM: number,
  highway?: string,
): WalkLine {
  const segPad = latLngPadForMeters(p1.lat, maxDistM + ROAD_JUNCTION_SLACK_M);
  return {
    p1,
    p2,
    minLat: Math.min(p1.lat, p2.lat) - segPad,
    maxLat: Math.max(p1.lat, p2.lat) + segPad,
    minLng: Math.min(p1.lng, p2.lng) - segPad,
    maxLng: Math.max(p1.lng, p2.lng) + segPad,
    maxDistM,
    highway,
  };
}

function lineToLatLng(line: LineCoords): LatLng[] {
  return line.map(([lng, lat]) => ({ lat, lng }));
}

/** VWorld 도로중심선 GeoJSON → WalkLine 세그먼트 */
export function featuresToWalkLines(
  features: GeoJsonFeature[],
  estimateHalfWidth: (props?: Record<string, unknown>) => number,
): WalkLine[] {
  const lines: WalkLine[] = [];

  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry?.coordinates) continue;

    const maxDistM = estimateHalfWidth(feature.properties);
    const highway = String(feature.properties?.rn ?? feature.properties?.RN ?? "road");

    if (geometry.type === "LineString") {
      const pts = lineToLatLng(geometry.coordinates as LineCoords);
      for (let i = 0; i < pts.length - 1; i += 1) {
        lines.push(makeWalkLineSegment(pts[i], pts[i + 1], maxDistM, highway));
      }
      continue;
    }

    if (geometry.type === "MultiLineString") {
      for (const part of geometry.coordinates as MultiLineCoords) {
        const pts = lineToLatLng(part);
        for (let i = 0; i < pts.length - 1; i += 1) {
          lines.push(makeWalkLineSegment(pts[i], pts[i + 1], maxDistM, highway));
        }
      }
    }
  }

  return lines;
}

export function featuresToStationPolygons(features: GeoJsonFeature[]): LatLng[][] {
  const polygons: LatLng[][] = [];

  for (const feature of features) {
    if (!isStationVworldBuilding(feature.properties)) continue;
    if (!feature.geometry) continue;
    polygons.push(...geometryToBlockPolygons(feature.geometry));
  }

  return polygons;
}

export function featuresToBlockPolygons(features: GeoJsonFeature[]): LatLng[][] {
  const polygons: LatLng[][] = [];

  for (const feature of features) {
    if (!feature.geometry) continue;
    if (isStationVworldBuilding(feature.properties)) continue;
    polygons.push(...geometryToBlockPolygons(feature.geometry));
  }

  return polygons;
}
