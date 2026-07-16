import type { BlockPolygon } from "./blockPolygon";

export type GameState = "SETUP" | "BRIEFING" | "PLAYING" | "GAMEOVER" | "VICTORY";

export type FacilityType = "light" | "police" | "bell" | "cctv" | "store";
export type { BlockPolygon };

export interface LatLng {
  lat: number;
  lng: number;
}

export type MovementLayer = "surface" | "underground";

export interface WalkLine {
  p1: LatLng;
  p2: LatLng;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** 이 도로 세그먼트에서 허용되는 중심선 거리(미터) */
  maxDistM: number;
  /** VWorld 도로명 (대로·골목 구분용) */
  highway?: string;
  /** 교차로 갭 메우기용 보조 세그먼트 — 건물 충돌 판정에는 사용 안 함 */
  isBridge?: boolean;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  name?: string;
  /** 도로명 주소 (예: 서울특별시 동대문구 휘경로 27) */
  roadAddress?: string;
  /** 지번 주소 (예: 서울특별시 동대문구 이문동 360-5) */
  jibunAddress?: string;
  /** 원본 표시 문자열 */
  displayName?: string;
}

export interface NormalizedFacility {
  id: string;
  type: FacilityType;
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  /** 겹치는 마커 좌우 분리용 (게임·미리보기 표시만) */
  displayLat?: number;
  displayLng?: number;
}

export interface RoadsData {
  walkLines: WalkLine[];
  /** 지하 구간으로 명시된 지하철 선로 */
  subwayLines: WalkLine[];
  walkPolygons: LatLng[][];
  /** 지상과 지하를 오갈 수 있는 역 구역 */
  stationPolygons: LatLng[][];
  /** 건물 밖을 이동할 수 있는 아파트 단지 구역 */
  apartmentPolygons: LatLng[][];
  /** 역사 건물 제외 — 통과 불가 영역 (bbox 캐시 포함) */
  blockPolygons: BlockPolygon[];
  /** 건물 충돌 데이터가 로드된 셀 영역. 영역 밖의 지상 이동은 잠시 차단한다. */
  buildingCoverage?: Bbox[];
}

export interface InputState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  ArrowUp: boolean;
  ArrowDown: boolean;
  ArrowLeft: boolean;
  ArrowRight: boolean;
}

export interface JoystickVector {
  x: number;
  y: number;
}

export const INITIAL_INPUT_STATE: InputState = {
  w: false,
  a: false,
  s: false,
  d: false,
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};
