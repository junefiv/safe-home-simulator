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
export const ROAD_SEGMENT_TOLERANCE_M = 14;
/** OSM way 끝점이 살짝 떨어져 있을 때 연결(미터) — 건물 밖 도로만 */
export const ROAD_BRIDGE_MAX_M = 10;
/** 교차로·코너 여유(미터) — 건물 밖 도로만 */
export const ROAD_JUNCTION_SLACK_M = 4;
/** 건물 안 도로 판정 시 끝점 여유(미터) */
export const ROAD_STRICT_ENDPOINT_SLACK_M = 2;

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
export const ROADS_BOUNDS_PADDING = 0.25;
/** 게임 중 고정 지도 줌 (Google roadmap 건물 윤곽은 17+에서 표시) */
export const GAME_MAP_ZOOM = 20;
/** VWorld/OSM 타일 최대 줌 — 초과 시 동일 타일이 2×2 격자로 반복됨 */
export const VWORLD_MAP_ZOOM = 19;
/** 건물 1회 요청 시 화면 셀 대비 bbox 확장 (1.0 = 3×3 영역) */
export const BUILDING_LOOKAHEAD_RATIO = 1.0;
/** 건물 타일 재검사 간격(ms) */
export const BUILDING_TILE_CHECK_MS = 500;
/** 동시 건물 로드 수 */
export const BUILDING_MAX_CONCURRENT = 2;

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