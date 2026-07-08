"use client";

import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBuildings, fetchFacilities, fetchRoads } from "@/lib/api-client";
import {
  BUILDING_MAX_CONCURRENT,
  BUILDING_TILE_CHECK_MS,
  FACILITIES_BBOX_PADDING,
  GAME_MAP_ZOOM,
  VWORLD_MAP_ZOOM,
  PLAYER_MAX_HP,
  ROADS_BOUNDS_PADDING,
  STORE_PLAYER_SPEED_MULTIPLIER,
} from "@/lib/game/constants";
import { wrapPolygons, type BlockPolygon } from "@/lib/game/blockPolygon";
import {
  GameFacility,
  Player,
  Zombie,
  createEmojiIcon,
  createHomeIcon,
} from "@/lib/game/entities";
import { updateGameLoop } from "@/lib/game/gameLoop";
import {
  collectSurroundingPolygons,
  createViewportGrid,
  getPlayerGridCell,
  getSurroundingCells,
  gridCellToBbox,
  isSameCell,
  pruneTileStore,
  sleep,
  type GridCell,
  type ViewportGrid,
} from "@/lib/game/viewportTiles";
import { cellStorageKey } from "@/lib/game/blockPolygon";
import {
  createMovementResolver,
  createPositionValidator,
  getNearestValidPoint,
  type MovementResolver,
} from "@/lib/game/roadValidation";
import {
  INITIAL_INPUT_STATE,
  type GameState,
  type Bbox,
  type GeocodeResult,
  type InputState,
  type JoystickVector,
  type LatLng,
  type MovementLayer,
  type RoadsData,
} from "@/lib/game/types";
import { DestinationIndicator } from "./DestinationIndicator";
import { EndScreens } from "./EndScreens";
import { HUD } from "./HUD";
import { Joystick } from "./Joystick";
import { MapView } from "./MapView";
import { StartScreen } from "./StartScreen";
import { Toast } from "./Toast";

function expandBbox(a: LatLng, b: LatLng, padding: number) {
  const south = Math.min(a.lat, b.lat);
  const north = Math.max(a.lat, b.lat);
  const west = Math.min(a.lng, b.lng);
  const east = Math.max(a.lng, b.lng);
  const latPad = (north - south) * padding;
  const lngPad = (east - west) * padding;
  return {
    south: south - latPad,
    north: north + latPad,
    west: west - lngPad,
    east: east + lngPad,
  };
}

const BUILDING_MAX_RETRIES = 3;

export function Game({ googleMapsApiKey = "" }: { googleMapsApiKey?: string }) {
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
  const buildingFetchRef = useRef({
    grid: null as ViewportGrid | null,
    tileStore: new Map<string, BlockPolygon[]>(),
    loadedCells: new Set<string>(),
    loadingKeys: new Set<string>(),
    retryCounts: new Map<string, number>(),
    coverageStore: new Map<string, Bbox>(),
    inflight: 0,
    lastCell: null as GridCell | null,
    lastCheckMs: 0,
  });
  const lastHudUpdateRef = useRef(0);

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
  const [movementLayer, setMovementLayer] = useState<MovementLayer>("surface");
  const [zombieCount, setZombieCount] = useState(0);
  const [mapDataLoading, setMapDataLoading] = useState(false);

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
    buildingFetchRef.current = {
      grid: null,
      tileStore: new Map(),
      loadedCells: new Set(),
      loadingKeys: new Set(),
      retryCounts: new Map(),
      coverageStore: new Map(),
      inflight: 0,
      lastCell: null,
      lastCheckMs: 0,
    };
    globalSirenRef.current = { active: false, timer: 0 };
    globalStunRef.current = { active: false, timer: 0 };
    pendingSirenRef.current = 0;
    pendingStunRef.current = 0;
    playerBoostTimerRef.current = 0;
    pendingPlayerBoostRef.current = 0;
  }, []);

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

  const syncActiveBlockPolygons = useCallback((cell: GridCell) => {
    const state = buildingFetchRef.current;
    pruneTileStore(state.tileStore, cell);
    for (const key of [...state.loadedCells]) {
      const [row, col] = key.split(":").map(Number);
      if (Math.abs(row - cell.row) > 2 || Math.abs(col - cell.col) > 2) {
        state.loadedCells.delete(key);
        state.retryCounts.delete(key);
        state.coverageStore.delete(key);
      }
    }
    roadsRef.current.blockPolygons = collectSurroundingPolygons(cell, state.tileStore);
    roadsRef.current.buildingCoverage = getSurroundingCells(cell)
      .map((nearby) => state.coverageStore.get(cellStorageKey(nearby.row, nearby.col)))
      .filter((bbox): bbox is Bbox => Boolean(bbox));
  }, []);

  const loadBuildingCell = useCallback(
    async (cell: GridCell, options?: { priority?: boolean }): Promise<boolean> => {
      const state = buildingFetchRef.current;
      if (!state.grid) return false;

      const key = cellStorageKey(cell.row, cell.col);
      if (state.loadedCells.has(key)) return true;
      if (state.loadingKeys.has(key)) return false;

      const priority = options?.priority ?? false;
      while (!priority && state.inflight >= BUILDING_MAX_CONCURRENT) {
        await sleep(80);
        if (state.loadedCells.has(key)) return true;
      }

      state.loadingKeys.add(key);
      state.inflight += 1;
      setMapDataLoading(true);

      let success = false;
      try {
        const rawBbox = gridCellToBbox(cell, state.grid);
        const latPad = (rawBbox.north - rawBbox.south) * 0.12;
        const lngPad = (rawBbox.east - rawBbox.west) * 0.12;
        const bbox = {
          south: rawBbox.south - latPad,
          north: rawBbox.north + latPad,
          west: rawBbox.west - lngPad,
          east: rawBbox.east + lngPad,
        };
        const raw = await fetchBuildings(bbox);
        const wrapped = wrapPolygons(raw);

        state.tileStore.set(key, wrapped);
        state.coverageStore.set(key, bbox);
        state.loadedCells.add(key);
        state.retryCounts.delete(key);
        success = true;
        if (state.lastCell) {
          syncActiveBlockPolygons(state.lastCell);
        }
      } catch {
        const retries = (state.retryCounts.get(key) ?? 0) + 1;
        state.retryCounts.set(key, retries);
      } finally {
        state.loadingKeys.delete(key);
        state.inflight -= 1;
        if (state.inflight === 0) setMapDataLoading(false);
      }

      return success;
    },
    [syncActiveBlockPolygons],
  );

  const scheduleViewportBuildingTiles = useCallback(
    (lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;

      const state = buildingFetchRef.current;
      const now = performance.now();
      if (now - state.lastCheckMs < BUILDING_TILE_CHECK_MS) return;
      state.lastCheckMs = now;

      if (!state.grid) {
        state.grid = createViewportGrid(map);
      }

      const cell = getPlayerGridCell(lat, lng, state.grid);
      const cellChanged = !isSameCell(state.lastCell, cell);

      if (cellChanged) {
        state.lastCell = cell;
        syncActiveBlockPolygons(cell);
      }

      const key = cellStorageKey(cell.row, cell.col);
      const retries = state.retryCounts.get(key) ?? 0;
      const needsLoad =
        !state.loadedCells.has(key) &&
        !state.loadingKeys.has(key) &&
        retries < BUILDING_MAX_RETRIES;

      if (needsLoad || (cellChanged && retries > 0 && retries < BUILDING_MAX_RETRIES)) {
        void loadBuildingCell(cell);
      }

      if (cellChanged) {
        const neighbors = [
          { row: cell.row - 1, col: cell.col },
          { row: cell.row + 1, col: cell.col },
          { row: cell.row, col: cell.col - 1 },
          { row: cell.row, col: cell.col + 1 },
        ];
        const prefetch = () => {
          for (const neighbor of neighbors) void loadBuildingCell(neighbor);
        };
        const requestIdle = window.requestIdleCallback;
        if (typeof requestIdle === "function") {
          requestIdle(prefetch, { timeout: 1200 });
        } else {
          globalThis.setTimeout(prefetch, 250);
        }
      }
    },
    [loadBuildingCell, syncActiveBlockPolygons],
  );

  const setupGame = useCallback(
    async (start: GeocodeResult, end: GeocodeResult) => {
      const map = mapRef.current;
      if (!map) {
        setToast("지도를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setLoading(true);
      setLoadingLabel("도로 데이터 로딩 중...");
      cleanupEntities();

      const startLatLng: LatLng = { lat: start.lat, lng: start.lng };
      const endLatLng: LatLng = { lat: end.lat, lng: end.lng };
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
      const facilityBbox = expandBbox(
        startLatLng,
        endLatLng,
        FACILITIES_BBOX_PADDING,
      );
      const facilityPromise = fetchFacilities(facilityBbox).then(
        (result) => ({ result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      );

      try {
        roadsRef.current = await fetchRoads(roadsBbox);
        movementRef.current = createMovementResolver(roadsRef.current);
        if (roadsRef.current.walkLines.length === 0) {
          setToast("이동 가능한 도로 데이터가 없습니다. 다시 시도해주세요.");
          setLoading(false);
          return;
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "도로 데이터를 불러오지 못했습니다. 다시 시도해주세요.";
        setToast(msg.includes("도로") ? msg : `도로 데이터를 불러오지 못했습니다. (${msg})`);
        setLoading(false);
        return;
      }

      setLoadingLabel("시설물·전국 파출소 로딩 중...");
      let facilityData: import("@/lib/game/types").NormalizedFacility[] = [];
      try {
        const facilityLoad = await facilityPromise;
        if (facilityLoad.error || !facilityLoad.result) throw facilityLoad.error;
        const facilityResult = facilityLoad.result;
        facilityData = facilityResult.facilities;
        if (facilityResult.loadReport?.light.error) {
          setToast(facilityResult.loadReport.light.error);
        } else if (facilityResult.loadReport?.light.isMock) {
          setToast("보안등은 API 미연동으로 임시(mock) 데이터입니다.");
        }
        const policeCount = facilityData.filter((f) => f.type === "police").length;
        if (policeCount === 0) {
          setToast("파출소 데이터가 없습니다. ODCLOUD·VWORLD API 키를 확인해주세요.");
        }
      } catch {
        facilityData = [];
        setToast("시설물 데이터 로딩에 실패했습니다.");
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

      const isValid = createPositionValidator(roadsRef.current);
      const startPt = getNearestValidPoint(
        startLatLng.lat,
        startLatLng.lng,
        roadsRef.current.walkLines,
      );
      if (!isValid(startPt.lat, startPt.lng) && roadsRef.current.walkLines.length > 0) {
        Object.assign(startPt, getNearestValidPoint(startPt.lat, startPt.lng, roadsRef.current.walkLines));
      }

      const playZoom = googleMapsApiKey.trim() ? GAME_MAP_ZOOM : VWORLD_MAP_ZOOM;
      map.setView([startPt.lat, startPt.lng], playZoom);

      setLoadingLabel("건물 데이터 로딩 중...");
      try {
        buildingFetchRef.current.grid = createViewportGrid(map);
        const startCell = getPlayerGridCell(
          startPt.lat,
          startPt.lng,
          buildingFetchRef.current.grid,
        );
        buildingFetchRef.current.lastCell = startCell;
        for (let attempt = 0; attempt < BUILDING_MAX_RETRIES; attempt += 1) {
          const ok = await loadBuildingCell(startCell, { priority: true });
          if (ok) break;
          await sleep(400);
        }
        syncActiveBlockPolygons(startCell);
      } catch {
        // 건물 없이도 진행
      }

      const facilityCallbacks = {
        onToast: (msg: string) => setToast(msg),
        onBellStun: (durationMs: number) => {
          pendingStunRef.current = Math.max(pendingStunRef.current, durationMs);
          setSirenActive(true);
        },
        onStoreFlee: (durationMs: number) => {
          pendingSirenRef.current = Math.max(pendingSirenRef.current, durationMs);
          pendingPlayerBoostRef.current = Math.max(
            pendingPlayerBoostRef.current,
            durationMs,
          );
          setSirenActive(true);
          if (!sirenOverlayRef.current) {
            const overlay = document.createElement("div");
            overlay.className =
              "fixed inset-0 border-[10px] border-red-500/50 pointer-events-none z-[2000] animate-pulse";
            document.body.appendChild(overlay);
            sirenOverlayRef.current = overlay;
          }
        },
        onPoliceRest: () => playerRef.current?.heal(1),
      };

      facilitiesRef.current = facilityData.map(
        (f) =>
          new GameFacility(f, map, {
            ...facilityCallbacks,
          }),
      );

      playerRef.current = new Player(startPt.lat, startPt.lng, map, {
        onDamage: () => setToast("좀비에게 공격당했습니다!"),
        onHpChange: (newHp) => {
          setHp(newHp);
          if (newHp <= 0) endGame(false);
        },
      });

      setHp(PLAYER_MAX_HP);
      setMovementLayer("surface");
      setZombieCount(0);
      setGameState("PLAYING");
      setShowHud(true);
      setShowJoystick(window.innerWidth <= 768);
      setLoading(false);

      lastTimeRef.current = performance.now();
      const tick = (timestamp: number) => {
        if (
          !playerRef.current ||
          !endRef.current ||
          !mapRef.current ||
          !movementRef.current
        ) return;

        // 긴 프레임 뒤 한 번에 크게 이동해 건물을 관통하지 않도록 보정한다.
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
          setMovementLayer(playerRef.current.movementLayer);
          setZombieCount(result.zombies.length);
        }

        scheduleViewportBuildingTiles(playerRef.current.lat, playerRef.current.lng);

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
    },
    [
      cleanupEntities,
      endGame,
      googleMapsApiKey,
      loadBuildingCell,
      scheduleViewportBuildingTiles,
      syncActiveBlockPolygons,
    ],
  );

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
      <MapView
        center={[37.5665, 126.978]}
        googleMapsApiKey={googleMapsApiKey}
        onMapReady={handleMapReady}
      />
      <Toast message={toast} onClear={() => setToast(null)} />
      {showHud && (
        <HUD
          hp={hp}
          maxHp={PLAYER_MAX_HP}
          distToHome={distToHome}
          sirenActive={sirenActive}
          movementLayer={movementLayer}
          zombieCount={zombieCount}
          mapDataLoading={mapDataLoading}
        />
      )}
      <DestinationIndicator
        map={mapInstance}
        destination={destination}
        getPlayerPosition={getPlayerPosition}
        distToHome={distToHome}
        active={gameState === "PLAYING"}
      />
      <Joystick
        visible={showHud && showJoystick}
        onChange={(v) => {
          joystickRef.current = v;
        }}
      />
      <StartScreen
        visible={gameState === "SETUP"}
        loading={loading}
        loadingLabel={loadingLabel}
        onStart={setupGame}
        onToast={setToast}
      />
      <EndScreens
        gameState={gameState === "GAMEOVER" || gameState === "VICTORY" ? gameState : null}
        onRestart={handleRestart}
      />
    </div>
  );
}
