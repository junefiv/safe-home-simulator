"use client";

import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBuildings, fetchFacilities, fetchRoads } from "@/lib/api-client";
import {
  BUILDING_LOOKAHEAD_RATIO,
  BUILDING_TILE_CHECK_MS,
  PLAYER_MAX_HP,
  ROADS_BOUNDS_PADDING,
  STORE_PLAYER_SPEED_MULTIPLIER,
  VWORLD_MAP_ZOOM,
} from "@/lib/game/constants";
import {
  GameFacility,
  Player,
  Zombie,
  createEmojiIcon,
  createHomeIcon,
} from "@/lib/game/entities";
import {
  buildRecommendation,
  buildSnappedPreviewRoute,
  buildStraightRoute,
  bboxAlongRoute,
  countFacilities,
  filterFacilitiesAlongRoute,
  layoutColocatedFacilityMarkers,
  routeDistanceM,
  type FacilityCounts,
  type LoadingPhase,
} from "@/lib/game/briefing";
import { haversineDistance } from "@/lib/game/geo";
import { updateGameLoop } from "@/lib/game/gameLoop";
import { cellStorageKey, wrapPolygons } from "@/lib/game/blockPolygon";
import {
  createMovementResolver,
  getNearestValidPoint,
  type MovementResolver,
} from "@/lib/game/roadValidation";
import {
  collectSurroundingPolygons,
  createViewportGrid,
  getBuildingFetchBbox,
  getPlayerGridCell,
  getSurroundBbox,
  getSurroundingCells,
  isSameCell,
  pruneTileStore,
  type GridCell,
  type ViewportGrid,
} from "@/lib/game/viewportTiles";
import {
  INITIAL_INPUT_STATE,
  type GameState,
  type GeocodeResult,
  type InputState,
  type JoystickVector,
  type LatLng,
  type NormalizedFacility,
  type RoadsData,
} from "@/lib/game/types";
import { DestinationIndicator } from "./DestinationIndicator";
import { EndScreens } from "./EndScreens";
import { HUD } from "./HUD";
import { Joystick } from "./Joystick";
import { MapView } from "./MapView";
import { RouteLoadingPreview } from "./RouteLoadingPreview";
import { StartScreen } from "./StartScreen";
import { Toast } from "./Toast";

const EMPTY_FACILITY_COUNTS: FacilityCounts = {
  light: 0,
  cctv: 0,
  police: 0,
  bell: 0,
  store: 0,
};

function walkLineKey(line: RoadsData["walkLines"][number]): string {
  return [
    line.p1.lat.toFixed(6),
    line.p1.lng.toFixed(6),
    line.p2.lat.toFixed(6),
    line.p2.lng.toFixed(6),
    Math.round(line.maxDistM),
    line.highway ?? "",
  ].join("|");
}

function mergeWalkLines(
  existing: RoadsData["walkLines"],
  incoming: RoadsData["walkLines"],
): RoadsData["walkLines"] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map(walkLineKey));
  const merged = [...existing];
  for (const line of incoming) {
    const key = walkLineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  return merged;
}

function mergePolygons(existing: LatLng[][], incoming: LatLng[][]): LatLng[][] {
  if (incoming.length === 0) return existing;
  const seen = new Set(
    existing.map((poly) =>
      `${poly[0]?.lat.toFixed(6)}|${poly[0]?.lng.toFixed(6)}|${poly.length}`,
    ),
  );
  const merged = [...existing];
  for (const poly of incoming) {
    if (poly.length < 3) continue;
    const key = `${poly[0].lat.toFixed(6)}|${poly[0].lng.toFixed(6)}|${poly.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(poly);
  }
  return merged;
}

export function Game() {
  const mapRef = useRef<L.Map | null>(null);
  const playerRef = useRef<Player | null>(null);
  const zombiesRef = useRef<Zombie[]>([]);
  const facilitiesRef = useRef<GameFacility[]>([]);
  const roadsRef = useRef<RoadsData>({
    walkLines: [],
    subwayLines: [],
    walkPolygons: [],
    stationPolygons: [],
    apartmentPolygons: [],
    blockPolygons: [],
    buildingCoverage: [],
  });
  const movementRef = useRef<MovementResolver | null>(null);
  const keysRef = useRef<InputState>({ ...INITIAL_INPUT_STATE });
  const joystickRef = useRef<JoystickVector>({ x: 0, y: 0 });
  const loopRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const globalSirenRef = useRef({ active: false, timer: 0 });
  const globalStunRef = useRef({ active: false, timer: 0 });
  const pendingSirenRef = useRef(0);
  const pendingStunRef = useRef(0);
  const playerBoostTimerRef = useRef(0);
  const pendingPlayerBoostRef = useRef(0);
  const zombieSpawnTimerRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  const viewportGridRef = useRef<ViewportGrid | null>(null);
  const lastRuntimeCellRef = useRef<GridCell | null>(null);
  const loadedRuntimeCellsRef = useRef<Set<string>>(new Set());
  const loadingRuntimeCellsRef = useRef<Set<string>>(new Set());
  const facilityIdsRef = useRef<Set<string>>(new Set());
  const buildingTileStoreRef = useRef<Map<string, ReturnType<typeof wrapPolygons>>>(
    new Map(),
  );

  const [gameState, setGameState] = useState<GameState>("SETUP");
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("귀가 시작");
  const [hp, setHp] = useState(PLAYER_MAX_HP);
  const [distToHome, setDistToHome] = useState<number | null>(null);
  const [sirenActive, setSirenActive] = useState(false);
  const [showHud, setShowHud] = useState(false);
  const [showJoystick, setShowJoystick] = useState(false);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [zombieCount, setZombieCount] = useState(0);
  const [storeGauge, setStoreGauge] = useState(0);
  const lastStoreGaugeRef = useRef(0);

  const [previewPhase, setPreviewPhase] = useState<LoadingPhase>("init");
  const [previewStart, setPreviewStart] = useState<LatLng | null>(null);
  const [previewEnd, setPreviewEnd] = useState<LatLng | null>(null);
  const [previewRoute, setPreviewRoute] = useState<LatLng[]>([]);
  const [roadsSnapped, setRoadsSnapped] = useState(false);
  const [previewFacilities, setPreviewFacilities] = useState<NormalizedFacility[]>([]);
  const [previewCounts, setPreviewCounts] = useState<FacilityCounts>(EMPTY_FACILITY_COUNTS);
  const [previewDistanceM, setPreviewDistanceM] = useState(0);
  const [previewRecommendation, setPreviewRecommendation] = useState("");

  const endRef = useRef<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const startMarkersRef = useRef<L.Layer[]>([]);
  const sirenOverlayRef = useRef<HTMLDivElement | null>(null);

  const cleanupEntities = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      if (playerRef.current?.marker) map.removeLayer(playerRef.current.marker);
      zombiesRef.current.forEach((z) => z.destroy(map));
      facilitiesRef.current.forEach((f) => f.destroy());
      startMarkersRef.current.forEach((m) => map.removeLayer(m));
    }
    playerRef.current = null;
    zombiesRef.current = [];
    facilitiesRef.current = [];
    startMarkersRef.current = [];
    zombieSpawnTimerRef.current = 0;
    movementRef.current = null;
    globalSirenRef.current = { active: false, timer: 0 };
    globalStunRef.current = { active: false, timer: 0 };
    pendingSirenRef.current = 0;
    pendingStunRef.current = 0;
    playerBoostTimerRef.current = 0;
    pendingPlayerBoostRef.current = 0;
    viewportGridRef.current = null;
    lastRuntimeCellRef.current = null;
    loadedRuntimeCellsRef.current = new Set();
    loadingRuntimeCellsRef.current = new Set();
    facilityIdsRef.current = new Set();
    buildingTileStoreRef.current = new Map();
  }, []);

  const createFacilityCallbacks = useCallback(
    () => ({
      onToast: (msg: string) => setToast(msg),
      onBellStun: (durationMs: number) => {
        pendingStunRef.current = Math.max(pendingStunRef.current, durationMs);
        setSirenActive(true);
      },
      onStoreBoost: (durationMs: number) => {
        pendingPlayerBoostRef.current = Math.max(
          pendingPlayerBoostRef.current,
          durationMs,
        );
      },
      onPoliceRest: () => playerRef.current?.heal(1),
    }),
    [],
  );

  const endGame = useCallback(
    (victory: boolean) => {
      setGameState(victory ? "VICTORY" : "GAMEOVER");
      setShowHud(false);
      setShowJoystick(false);
      setSirenActive(false);
      if (loopRef.current !== null) {
        cancelAnimationFrame(loopRef.current);
        loopRef.current = null;
      }
      if (sirenOverlayRef.current) {
        sirenOverlayRef.current.remove();
        sirenOverlayRef.current = null;
      }
    },
    [],
  );

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
    setMapInstance(map);
  }, []);

  const getPlayerPosition = useCallback(
    (): LatLng | null => playerRef.current?.latlng ?? null,
    [],
  );

  const startGameLoop = useCallback(() => {
    lastTimeRef.current = performance.now();
    const tick = (timestamp: number) => {
      if (
        !playerRef.current ||
        !endRef.current ||
        !mapRef.current ||
        !movementRef.current
      ) {
        return;
      }

      const dt = Math.min(timestamp - lastTimeRef.current, 50);
      lastTimeRef.current = timestamp;
      playerBoostTimerRef.current = Math.max(0, playerBoostTimerRef.current - dt);

      const result = updateGameLoop({
        dt,
        playing: true,
        player: playerRef.current,
        keys: keysRef.current,
        joystick: joystickRef.current,
        zombies: zombiesRef.current,
        facilities: facilitiesRef.current,
        walkLines: roadsRef.current.walkLines,
        subwayLines: roadsRef.current.subwayLines,
        movement: movementRef.current,
        playerSpeedMultiplier:
          playerBoostTimerRef.current > 0 ? STORE_PLAYER_SPEED_MULTIPLIER : 1,
        endLatLng: endRef.current,
        map: mapRef.current,
        globalSirenActive: globalSirenRef.current.active,
        globalSirenTimer: globalSirenRef.current.timer,
        globalStunActive: globalStunRef.current.active,
        globalStunTimer: globalStunRef.current.timer,
        zombieSpawnTimer: zombieSpawnTimerRef.current,
      });

      zombiesRef.current = result.zombies;
      globalSirenRef.current = pendingSirenRef.current > 0
        ? { active: true, timer: pendingSirenRef.current }
        : { active: result.globalSirenActive, timer: result.globalSirenTimer };
      globalStunRef.current = pendingStunRef.current > 0
        ? { active: true, timer: pendingStunRef.current }
        : { active: result.globalStunActive, timer: result.globalStunTimer };
      pendingSirenRef.current = 0;
      pendingStunRef.current = 0;
      if (pendingPlayerBoostRef.current > 0) {
        playerBoostTimerRef.current = pendingPlayerBoostRef.current;
      }
      pendingPlayerBoostRef.current = 0;
      zombieSpawnTimerRef.current = result.zombieSpawnTimer;

      if (timestamp - lastHudUpdateRef.current > 200) {
        lastHudUpdateRef.current = timestamp;
        setDistToHome(result.distToHome);
        setSirenActive(
          globalSirenRef.current.active || globalStunRef.current.active,
        );
        setZombieCount(result.zombies.length);
      }

      let maxGauge = 0;
      for (const facility of facilitiesRef.current) {
        if (facility.type === "store" && facility.gaugeProgress > maxGauge) {
          maxGauge = facility.gaugeProgress;
        }
      }
      if (
        Math.abs(maxGauge - lastStoreGaugeRef.current) > 0.02 ||
        (maxGauge > 0) !== (lastStoreGaugeRef.current > 0)
      ) {
        lastStoreGaugeRef.current = maxGauge;
        setStoreGauge(maxGauge);
      }

      if (
        !globalSirenRef.current.active &&
        !globalStunRef.current.active &&
        sirenOverlayRef.current
      ) {
        sirenOverlayRef.current.remove();
        sirenOverlayRef.current = null;
      }

      if (result.victory) {
        endGame(true);
        return;
      }

      loopRef.current = requestAnimationFrame(tick);
    };

    loopRef.current = requestAnimationFrame(tick);
  }, [endGame]);

  const beginPlaying = useCallback(() => {
    setGameState("PLAYING");
    setShowHud(true);
    setShowJoystick(window.innerWidth <= 768);
    startGameLoop();
  }, [startGameLoop]);

  const setupGame = useCallback(
    async (start: GeocodeResult, end: GeocodeResult) => {
      const map = mapRef.current;
      if (!map) {
        setToast("지도를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      const startLatLng: LatLng = { lat: start.lat, lng: start.lng };
      const endLatLng: LatLng = { lat: end.lat, lng: end.lng };
      const straightDistance = haversineDistance(startLatLng, endLatLng);

      setLoading(true);
      setLoadingLabel("도로 데이터 로딩 중...");
      setPreviewPhase("init");
      setPreviewStart(startLatLng);
      setPreviewEnd(endLatLng);
      setPreviewRoute(buildStraightRoute(startLatLng, endLatLng, 12));
      setRoadsSnapped(false);
      setPreviewFacilities([]);
      setPreviewCounts(EMPTY_FACILITY_COUNTS);
      setPreviewDistanceM(straightDistance);
      setPreviewRecommendation("");
      cleanupEntities();

      endRef.current = endLatLng;
      setDestination(endLatLng);

      const bounds = L.latLngBounds(
        [startLatLng.lat, startLatLng.lng],
        [endLatLng.lat, endLatLng.lng],
      );
      const padded = bounds.pad(ROADS_BOUNDS_PADDING);
      const roadsBbox = {
        south: padded.getSouth(),
        west: padded.getWest(),
        north: padded.getNorth(),
        east: padded.getEast(),
      };

      setPreviewPhase("roads");
      let routeDistance = straightDistance;
      let snapped = buildStraightRoute(startLatLng, endLatLng, 12);
      try {
        roadsRef.current = await fetchRoads(roadsBbox);
        movementRef.current = createMovementResolver(roadsRef.current);
        if (roadsRef.current.walkLines.length === 0) {
          setToast("이동 가능한 도로 데이터가 없습니다. 다시 시도해주세요.");
          setLoading(false);
          setPreviewPhase("init");
          return;
        }
        snapped = buildSnappedPreviewRoute(
          startLatLng,
          endLatLng,
          roadsRef.current.walkLines,
        );
        routeDistance = routeDistanceM(snapped) || straightDistance;
        setPreviewRoute(snapped);
        setRoadsSnapped(true);
        setPreviewDistanceM(routeDistance);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "도로 데이터를 불러오지 못했습니다. 다시 시도해주세요.";
        setToast(msg.includes("도로") ? msg : `도로 데이터를 불러오지 못했습니다. (${msg})`);
        setLoading(false);
        setPreviewPhase("init");
        return;
      }

      setPreviewPhase("facilities");
      setLoadingLabel("주변 안전시설 스캔 중...");
      let briefingFacilities: NormalizedFacility[] = [];
      let gameFacilities: NormalizedFacility[] = [];
      try {
        const facilityResult = await fetchFacilities(bboxAlongRoute(snapped));
        gameFacilities = layoutColocatedFacilityMarkers(facilityResult.facilities);
        briefingFacilities = filterFacilitiesAlongRoute(gameFacilities, snapped);
        const counts = countFacilities(briefingFacilities);
        setPreviewFacilities(briefingFacilities);
        setPreviewCounts(counts);
        setPreviewRecommendation(buildRecommendation(routeDistance, counts));
        if (facilityResult.loadReport?.light.error) {
          setToast(facilityResult.loadReport.light.error);
        } else if (facilityResult.loadReport?.light.isMock) {
          setToast("보안등은 API 미연동으로 임시(mock) 데이터입니다.");
        }
        if (counts.police === 0) {
          const policeInBbox = facilityResult.loadReport?.police.inBbox ?? 0;
          if (facilityResult.loadReport?.police.error) {
            setToast(facilityResult.loadReport.police.error);
          } else if (policeInBbox === 0) {
            setToast("이 귀가 경로 근처에 파출소·지구대가 없습니다.");
          }
        }
      } catch {
        briefingFacilities = [];
        gameFacilities = [];
        setToast("시설물 데이터 로딩에 실패했습니다.");
      }

      setPreviewPhase("buildings");
      setLoadingLabel("嫄대Ъ 異⑸룎 ?곗씠??濡쒕뵫 以?..");
      try {
        const initialBuildings = await fetchBuildings(roadsBbox);
        roadsRef.current = {
          ...roadsRef.current,
          blockPolygons: wrapPolygons(initialBuildings),
        };
        movementRef.current = createMovementResolver(roadsRef.current);
      } catch (err) {
        console.warn(
          "[buildings] 초기 건물 데이터 로드 실패:",
          err instanceof Error ? err.message : err,
        );
      }

      const startMarker = L.marker([startLatLng.lat, startLatLng.lng], {
        icon: createEmojiIcon("🚩"),
      })
        .addTo(map)
        .bindPopup("출발지")
        .openPopup();
      const endMarker = L.marker([endLatLng.lat, endLatLng.lng], {
        icon: createHomeIcon(),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup("도착지");
      const endPulse = L.circle([endLatLng.lat, endLatLng.lng], {
        radius: 30,
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.25,
        weight: 4,
        className: "home-marker-pulse",
      }).addTo(map);
      startMarkersRef.current = [startMarker, endMarker, endPulse];

      const startPt = getNearestValidPoint(
        startLatLng.lat,
        startLatLng.lng,
        roadsRef.current.walkLines,
      );

      map.setView([startPt.lat, startPt.lng], VWORLD_MAP_ZOOM);

      const facilityCallbacks = createFacilityCallbacks();

      facilitiesRef.current = gameFacilities.map(
        (f) =>
          new GameFacility(f, map, {
            ...facilityCallbacks,
          }),
      );
      facilityIdsRef.current = new Set(gameFacilities.map((f) => f.id));
      viewportGridRef.current = createViewportGrid(map);
      lastRuntimeCellRef.current = null;

      playerRef.current = new Player(startPt.lat, startPt.lng, map, {
        onDamage: () => setToast("좀비에게 공격당했습니다!"),
        onHpChange: (newHp) => {
          setHp(newHp);
          if (newHp <= 0) endGame(false);
        },
      });

      setHp(PLAYER_MAX_HP);
      setZombieCount(0);
      setPreviewCounts(countFacilities(briefingFacilities));
      setPreviewRecommendation(
        buildRecommendation(routeDistance, countFacilities(briefingFacilities)),
      );
      setPreviewPhase("ready");
      setGameState("BRIEFING");
      setLoading(false);
    },
    [cleanupEntities, createFacilityCallbacks, endGame],
  );

  useEffect(() => {
    if (gameState !== "PLAYING") return;

    let cancelled = false;

    const loadRuntimeCell = async (cell: GridCell, grid: ViewportGrid) => {
      const centerKey = cellStorageKey(cell.row, cell.col);
      if (
        loadedRuntimeCellsRef.current.has(centerKey) ||
        loadingRuntimeCellsRef.current.has(centerKey)
      ) {
        return;
      }

      const cells = getSurroundingCells(cell);
      const missingCells = cells.filter((candidate) => {
        const key = cellStorageKey(candidate.row, candidate.col);
        return (
          !loadedRuntimeCellsRef.current.has(key) &&
          !loadingRuntimeCellsRef.current.has(key)
        );
      });
      loadingRuntimeCellsRef.current.add(centerKey);
      for (const candidate of missingCells) {
        loadingRuntimeCellsRef.current.add(cellStorageKey(candidate.row, candidate.col));
      }

      try {
        const surroundBbox = getSurroundBbox(cell, grid);
        const [roads, facilityResult] = await Promise.all([
          fetchRoads(surroundBbox),
          fetchFacilities(surroundBbox),
        ]);

        if (cancelled) return;

        const currentRoads = roadsRef.current;
        const stationPolygons = mergePolygons(
          currentRoads.stationPolygons,
          roads.stationPolygons ?? [],
        );
        const walkPolygons = mergePolygons(
          currentRoads.walkPolygons,
          roads.walkPolygons ?? roads.stationPolygons ?? [],
        );
        roadsRef.current = {
          ...currentRoads,
          walkLines: mergeWalkLines(currentRoads.walkLines, roads.walkLines),
          subwayLines: mergeWalkLines(
            currentRoads.subwayLines,
            roads.subwayLines ?? [],
          ),
          stationPolygons,
          walkPolygons,
          apartmentPolygons: [],
        };

        const map = mapRef.current;
        if (map) {
          const callbacks = createFacilityCallbacks();
          const newFacilities = layoutColocatedFacilityMarkers(
            facilityResult.facilities.filter((facility) => {
              if (facilityIdsRef.current.has(facility.id)) return false;
              facilityIdsRef.current.add(facility.id);
              return true;
            }),
          ).map((facility) => new GameFacility(facility, map, callbacks));
          if (newFacilities.length > 0) {
            facilitiesRef.current = [...facilitiesRef.current, ...newFacilities];
          }
        }

        const buildingResults = await Promise.all(
          missingCells.map(async (candidate) => {
            const bbox = getBuildingFetchBbox(candidate, grid, BUILDING_LOOKAHEAD_RATIO);
            const polygons = await fetchBuildings(bbox);
            return { key: cellStorageKey(candidate.row, candidate.col), polygons };
          }),
        );

        if (cancelled) return;

        for (const result of buildingResults) {
          buildingTileStoreRef.current.set(result.key, wrapPolygons(result.polygons));
        }
        roadsRef.current = {
          ...roadsRef.current,
          blockPolygons: collectSurroundingPolygons(
            cell,
            buildingTileStoreRef.current,
          ),
        };
        pruneTileStore(buildingTileStoreRef.current, cell);
        movementRef.current = createMovementResolver(roadsRef.current);

        for (const candidate of cells) {
          loadedRuntimeCellsRef.current.add(cellStorageKey(candidate.row, candidate.col));
        }
      } catch (err) {
        console.warn(
          "[runtime-map] 주변 데이터 로드 실패:",
          err instanceof Error ? err.message : err,
        );
      } finally {
        loadingRuntimeCellsRef.current.delete(centerKey);
        for (const candidate of missingCells) {
          loadingRuntimeCellsRef.current.delete(
            cellStorageKey(candidate.row, candidate.col),
          );
        }
      }
    };

    const interval = window.setInterval(() => {
      const player = playerRef.current;
      const map = mapRef.current;
      if (!player || !map) return;

      let grid = viewportGridRef.current;
      if (!grid) {
        grid = createViewportGrid(map);
        viewportGridRef.current = grid;
      }

      const cell = getPlayerGridCell(player.lat, player.lng, grid);
      if (isSameCell(lastRuntimeCellRef.current, cell)) return;
      lastRuntimeCellRef.current = cell;
      void loadRuntimeCell(cell, grid);
    }, BUILDING_TILE_CHECK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [createFacilityCallbacks, gameState]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();
      if (lower in keysRef.current) {
        keysRef.current[lower as keyof InputState] = true;
      }
      if (key in keysRef.current) {
        keysRef.current[key as keyof InputState] = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();
      if (lower in keysRef.current) {
        keysRef.current[lower as keyof InputState] = false;
      }
      if (key in keysRef.current) {
        keysRef.current[key as keyof InputState] = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (loopRef.current !== null) cancelAnimationFrame(loopRef.current);
    };
  }, []);

  const handleRestart = () => {
    cleanupEntities();
    setGameState("SETUP");
    setShowHud(false);
    setHp(PLAYER_MAX_HP);
    setDistToHome(null);
    endRef.current = null;
    setDestination(null);
    window.location.reload();
  };

  return (
    <div className="game-root">
      <MapView center={[37.5665, 126.978]} onMapReady={handleMapReady} />
      <Toast message={toast} onClear={() => setToast(null)} />
      {showHud && (
        <HUD
          hp={hp}
          maxHp={PLAYER_MAX_HP}
          distToHome={distToHome}
          sirenActive={sirenActive}
          zombieCount={zombieCount}
        />
      )}
      <DestinationIndicator
        map={mapInstance}
        destination={destination}
        getPlayerPosition={getPlayerPosition}
        distToHome={distToHome}
        active={gameState === "PLAYING"}
      />
      {showHud && storeGauge > 0 && (
        <div className="store-gauge" role="status">
          <div className="store-gauge-label">🏪 에너지 드링크 충전 중…</div>
          <div className="store-gauge-track">
            <div
              className="store-gauge-fill"
              style={{ width: `${Math.round(storeGauge * 100)}%` }}
            />
          </div>
        </div>
      )}
      <Joystick
        visible={showHud && showJoystick}
        onChange={(v) => {
          joystickRef.current = v;
        }}
      />
      <StartScreen
        visible={gameState === "SETUP" && !loading}
        loading={loading}
        loadingLabel={loadingLabel}
        onStart={setupGame}
        onToast={setToast}
      />
      <RouteLoadingPreview
        visible={loading || gameState === "BRIEFING"}
        ready={gameState === "BRIEFING"}
        phase={previewPhase}
        loadingLabel={loadingLabel}
        start={previewStart}
        end={previewEnd}
        routePoints={previewRoute}
        roadsSnapped={roadsSnapped}
        facilities={previewFacilities}
        counts={previewCounts}
        distanceM={previewDistanceM}
        recommendation={previewRecommendation}
        onBegin={beginPlaying}
      />
      <EndScreens
        gameState={gameState === "GAMEOVER" || gameState === "VICTORY" ? gameState : null}
        onRestart={handleRestart}
      />
    </div>
  );
}
