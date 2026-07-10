export const PLAYER_SPEED_MPS = 8;
export const PLAYER_MAX_HP = 3;
export const PLAYER_INVULNERABLE_MS = 2000;
/** 지도 마커 크기(px) — 도로·건물 대비 사람 비율 */
export const PLAYER_MARKER_PX = 22;
/** 건물 충돌 판정 시 캐릭터 발끝 여유(미터) */
export const PLAYER_FOOTPRINT_M = 0.35;

export const ZOMBIE_BASE_SPEED_MPS = 6;
export const ZOMBIE_FLEE_SPEED_MULTIPLIER = 1.5;
export const ZOMBIE_MAX_COUNT = 12;
export const ZOMBIE_SPAWN_INTERVAL_MS = 4500;
export const ZOMBIE_SPAWN_MIN_DISTANCE_M = 50;
export const ZOMBIE_SPAWN_MAX_DISTANCE_M = 110;
export const ZOMBIE_COLLISION_DISTANCE_M = 1.5;
/** 도로 그래프 경로 갱신 — 가까운 좀비 */
export const ZOMBIE_PATH_REFRESH_NEAR_MS = 800;
/** 도로 그래프 경로 갱신 — 먼 좀비 */
export const ZOMBIE_PATH_REFRESH_FAR_MS = 2000;
export const ZOMBIE_PATH_NEAR_DIST_M = 120;
export const ZOMBIE_WAYPOINT_REACH_M = 5;
/** 연속 막힘 0.5초 → 도로 스냅·슬라이드 강화 */
export const ZOMBIE_STUCK_ESCAPE_MS = 500;
/** 연속 막힘 2.5초 → 페이드아웃 후 리스폰 */
export const ZOMBIE_STUCK_RESPAWN_MS = 5000;
export const ZOMBIE_STUCK_SNAP_M = 1.5;
/** 프레임마다 이동 목표에 이만큼(m) 이상 가까워져야 진행으로 인정 */
export const ZOMBIE_STUCK_MIN_PROGRESS_M = 0.08;
export const ZOMBIE_RESPAWN_FADE_OUT_MS = 600;
export const ZOMBIE_RESPAWN_FADE_IN_MS = 400;
/** 지도 마커 크기(px) */
export const ZOMBIE_MARKER_PX = 20;

export const WIN_DISTANCE_M = 20;
/** 도로 중심선 허용 반경 기본값(미터) */
export const ROAD_SEGMENT_TOLERANCE_M = 14;
/** 건물 폴리곤을 안쪽으로 줄여 캐릭터가 좁은 도로를 지나갈 여유(미터) */
export const BUILDING_COLLISION_INSET_M = 0.2;
/** OSM way 끝점이 살짝 떨어져 있을 때 연결(미터) — 건물 밖 도로만 */
export const ROAD_BRIDGE_MAX_M = 18;
/** 교차로·코너 여유(미터) — 건물 밖 도로만 */
export const ROAD_JUNCTION_SLACK_M = 8;
/** 건물 데이터가 도로 위로 겹칠 때 추가 허용(미터) */
export const ROAD_BUILDING_OVERLAP_SLACK_M = 5;
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
export const BUILDING_MAX_CONCURRENT = 1;

export const LIGHT_RADIUS_M = 5;
export const CCTV_RADIUS_M = 10;
/** 파출소·지구대 자동 발동 반경(미터) */
export const POLICE_RADIUS_M = 8;
/** 파출소 안전구역 배리어가 파이 형태로 채워지는 시간(ms) */
export const POLICE_BARRIER_FORM_MS = 3000;
export const BELL_RADIUS_M = 5;
export const BELL_INTERACT_DISTANCE_M = 4;
export const BELL_COUNTDOWN_MS = 5000;
export const BELL_COOLDOWN_MS = 30000;
export const BELL_STUN_DURATION_MS = 3000;
/** 편의점 자동 발동 반경(미터) */
export const STORE_RADIUS_M = 8;
/** 편의점 반경 안에서 게이지가 가득 차기까지 시간(ms) */
export const STORE_GAUGE_FILL_MS = 5000;
/** 편의점 충전 완료 후 이동 속도 버프 지속(ms) */
export const STORE_BOOST_DURATION_MS = 5000;
export const STORE_COOLDOWN_MS = 60000;
export const STORE_PLAYER_SPEED_MULTIPLIER = 1.2;
export const GLOBAL_SIREN_DURATION_MS = STORE_BOOST_DURATION_MS;
export const LIGHT_SLOW_FACTOR = 0.9;
/** CCTV 반경에 닿은 좀비의 어그로 해제 지속 시간(ms) */
export const CCTV_AGGRO_RELEASE_MS = 3000;
/** 같은 CCTV가 같은 좀비에게 다시 어그로를 해제하기까지의 쿨다운(ms) */
export const CCTV_AGGRO_COOLDOWN_MS = 30000;

export const FACILITIES_BBOX_PADDING = 0.15;
/** 귀가 경로 선에서 이 거리(미터) 이내 시설만 카운트·스폰 */
export const ROUTE_CORRIDOR_RADIUS_M = 80;
/** 경로 기반 bbox 여유(미터) — API 조회용 */
export const ROUTE_CORRIDOR_FETCH_PADDING_M = 120;
export const FACILITIES_CACHE_TTL_MS = 5 * 60 * 1000;
/** 파출소·지구대 목록 + 지오코딩 결과 일일 캐시 */
export const POLICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
