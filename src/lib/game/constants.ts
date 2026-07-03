export const PLAYER_SPEED_MPS = 8;
export const PLAYER_MAX_HP = 3;
export const PLAYER_INVULNERABLE_MS = 2000;

export const ZOMBIE_BASE_SPEED_MPS = 6;
export const ZOMBIE_FLEE_SPEED_MULTIPLIER = 1.5;
export const ZOMBIE_MAX_COUNT = 25;
export const ZOMBIE_SPAWN_INTERVAL_MS = 3000;
export const ZOMBIE_SPAWN_MIN_DISTANCE_M = 80;
export const ZOMBIE_SPAWN_MAX_DISTANCE_M = 150;
export const ZOMBIE_COLLISION_DISTANCE_M = 10;

export const WIN_DISTANCE_M = 20;
/** 도로 중심선 허용 반경 기본값(미터) */
export const ROAD_SEGMENT_TOLERANCE_M = 12;

/** 이동 가능 OSM highway 타입 (미등록 타입도 highway= 이면 허용) */
export const WALKABLE_HIGHWAY_TYPES = new Set([
  // 차량 도로
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
  "track",
  "busway",
  "bus_guideway",
  // 보행·자전거
  "footway",
  "path",
  "pedestrian",
  "steps",
  "cycleway",
  "bridleway",
  // 기타
  "construction",
  "proposed",
  "platform",
  "raceway",
  "corridor",
  "elevator",
  "escalator",
]);
export const ROADS_BOUNDS_PADDING = 0.1;

export const LIGHT_RADIUS_M = 20;
export const POLICE_RADIUS_M = 40;
export const BELL_RADIUS_M = 10;
export const BELL_INTERACT_DISTANCE_M = 30;
export const BELL_COUNTDOWN_MS = 10000;
export const BELL_COOLDOWN_MS = 20000;
export const GLOBAL_SIREN_DURATION_MS = 5000;
export const LIGHT_SLOW_FACTOR = 0.4;

export const FACILITIES_BBOX_PADDING = 0.15;
export const FACILITIES_CACHE_TTL_MS = 5 * 60 * 1000;
/** 파출소·지구대 목록 + 지오코딩 결과 일일 캐시 */
export const POLICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;