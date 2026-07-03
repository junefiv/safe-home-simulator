"use client";

import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFacilities, fetchRoads } from "@/lib/api-client";
import {
  FACILITIES_BBOX_PADDING,
  PLAYER_MAX_HP,
  ROADS_BOUNDS_PADDING,
} from "@/lib/game/constants";
import {
  GameFacility,
  Player,
  Zombie,
  createEmojiIcon,
  triggerGlobalSirenState,
} from "@/lib/game/entities";
import { updateGameLoop } from "@/lib/game/gameLoop";
import { createPositionValidator, getNearestValidPoint } from "@/lib/game/roadValidation";
import {
  INITIAL_INPUT_STATE,
  type GameState,
  type GeocodeResult,
  type InputState,
  type JoystickVector,
  type LatLng,
  type RoadsData,
} from "@/lib/game/types";
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

export function Game() {
  const mapRef = useRef<L.Map | null>(null);
  const playerRef = useRef<Player | null>(null);
  const zombiesRef = useRef<Zombie[]>([]);
  const facilitiesRef = useRef<GameFacility[]>([]);
  const roadsRef = useRef<RoadsData>({ walkLines: [], walkPolygons: [] });
  const keysRef = useRef<InputState>({ ...INITIAL_INPUT_STATE });
  const joystickRef = useRef<JoystickVector>({ x: 0, y: 0 });
  const loopRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const globalSirenRef = useRef({ active: false, timer: 0 });
  const zombieSpawnTimerRef = useRef(0);

  const [gameState, setGameState] = useState<GameState>("SETUP");
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("귀가 시작");
  const [hp, setHp] = useState(PLAYER_MAX_HP);
  const [distToHome, setDistToHome] = useState<number | null>(null);
  const [sirenActive, setSirenActive] = useState(false);
  const [showHud, setShowHud] = useState(false);
  const [showJoystick, setShowJoystick] = useState(false);

  const endRef = useRef<LatLng | null>(null);
  const startMarkersRef = useRef<L.Marker[]>([]);
  const sirenOverlayRef = useRef<HTMLDivElement | null>(null);

  const cleanupEntities = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      playerRef.current?.marker && map.removeLayer(playerRef.current.marker);
      zombiesRef.current.forEach((z) => z.destroy(map));
      facilitiesRef.current.forEach((f) => f.destroy());
      startMarkersRef.current.forEach((m) => map.removeLayer(m));
    }
    playerRef.current = null;
    zombiesRef.current = [];
    facilitiesRef.current = [];
    startMarkersRef.current = [];
    zombieSpawnTimerRef.current = 0;
    globalSirenRef.current = { active: false, timer: 0 };
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
  }, []);

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

      try {
        roadsRef.current = await fetchRoads(roadsBbox);
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
      const facilityBbox = expandBbox(startLatLng, endLatLng, FACILITIES_BBOX_PADDING);
      let facilityData: import("@/lib/game/types").NormalizedFacility[] = [];
      try {
        const facilityResult = await fetchFacilities(facilityBbox);
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

      map.fitBounds(bounds, { padding: [50, 50] });

      const startMarker = L.marker([startLatLng.lat, startLatLng.lng], {
        icon: createEmojiIcon("🚩"),
      })
        .addTo(map)
        .bindPopup("출발지")
        .openPopup();
      const endMarker = L.marker([endLatLng.lat, endLatLng.lng], {
        icon: createEmojiIcon("🏠"),
      })
        .addTo(map)
        .bindPopup("도착지");
      startMarkersRef.current = [startMarker, endMarker];

      const isValid = createPositionValidator(roadsRef.current);
      const startPt = getNearestValidPoint(
        startLatLng.lat,
        startLatLng.lng,
        roadsRef.current.walkLines,
      );
      if (!isValid(startPt.lat, startPt.lng) && roadsRef.current.walkLines.length > 0) {
        Object.assign(startPt, getNearestValidPoint(startPt.lat, startPt.lng, roadsRef.current.walkLines));
      }

      const facilityCallbacks = {
        onToast: (msg: string) => setToast(msg),
        onGlobalSiren: () => {
          const siren = triggerGlobalSirenState();
          globalSirenRef.current = siren;
          setSirenActive(true);
          if (!sirenOverlayRef.current) {
            const overlay = document.createElement("div");
            overlay.className =
              "fixed inset-0 border-[10px] border-red-500/50 pointer-events-none z-[2000] animate-pulse";
            document.body.appendChild(overlay);
            sirenOverlayRef.current = overlay;
          }
        },
      };

      facilitiesRef.current = facilityData.map(
        (f) =>
          new GameFacility(f, map, {
            ...facilityCallbacks,
          }),
      );

      facilitiesRef.current.forEach((f) => {
        if (f.type !== "bell" || !f.circle) return;
        f.marker.off("click");
        f.circle.off("click");
        const interact = () =>
          f.interact(() => playerRef.current?.latlng ?? null, gameState === "PLAYING");
        f.marker.on("click", interact);
        f.circle.on("click", interact);
      });

      playerRef.current = new Player(startPt.lat, startPt.lng, map, isValid, {
        onDamage: () => setToast("좀비에게 공격당했습니다!"),
        onHpChange: (newHp) => {
          setHp(newHp);
          if (newHp <= 0) endGame(false);
        },
      });

      setHp(PLAYER_MAX_HP);
      setGameState("PLAYING");
      setShowHud(true);
      setShowJoystick(window.innerWidth <= 768);
      setLoading(false);

      lastTimeRef.current = performance.now();
      const tick = (timestamp: number) => {
        if (!playerRef.current || !endRef.current || !mapRef.current) return;

        const dt = timestamp - lastTimeRef.current;
        lastTimeRef.current = timestamp;

        const result = updateGameLoop({
          dt,
          playing: true,
          player: playerRef.current,
          keys: keysRef.current,
          joystick: joystickRef.current,
          zombies: zombiesRef.current,
          facilities: facilitiesRef.current,
          walkLines: roadsRef.current.walkLines,
          walkPolygons: roadsRef.current.walkPolygons,
          endLatLng: endRef.current,
          map: mapRef.current,
          globalSirenActive: globalSirenRef.current.active,
          globalSirenTimer: globalSirenRef.current.timer,
          zombieSpawnTimer: zombieSpawnTimerRef.current,
        });

        zombiesRef.current = result.zombies;
        globalSirenRef.current = {
          active: result.globalSirenActive,
          timer: result.globalSirenTimer,
        };
        zombieSpawnTimerRef.current = result.zombieSpawnTimer;
        setDistToHome(result.distToHome);
        setSirenActive(result.globalSirenActive);

        if (!result.globalSirenActive && sirenOverlayRef.current) {
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
    [cleanupEntities, endGame, gameState],
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
    window.location.reload();
  };

  return (
    <div className="game-root">
      <MapView center={[37.5665, 126.978]} onMapReady={handleMapReady} />
      <Toast message={toast} onClear={() => setToast(null)} />
      {showHud && (
        <HUD hp={hp} maxHp={PLAYER_MAX_HP} distToHome={distToHome} sirenActive={sirenActive} />
      )}
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