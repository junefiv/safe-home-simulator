export type GameState = "SETUP" | "PLAYING" | "GAMEOVER" | "VICTORY";

export type FacilityType = "light" | "police" | "bell" | "cctv";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WalkLine {
  p1: LatLng;
  p2: LatLng;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** 이 도로 세그먼트에서 허용되는 중심선 거리(미터) */
  maxDistM: number;
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
  /** 원본 표시 문자열 (Nominatim fallback) */
  displayName?: string;
}

export interface NormalizedFacility {
  id: string;
  type: FacilityType;
  lat: number;
  lng: number;
  name?: string;
  address?: string;
}

export interface RoadsData {
  walkLines: WalkLine[];
  walkPolygons: LatLng[][];
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