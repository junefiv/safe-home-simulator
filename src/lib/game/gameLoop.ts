import type L from "leaflet";
import {
  WIN_DISTANCE_M,
  ZOMBIE_MAX_COUNT,
  ZOMBIE_SPAWN_INTERVAL_MS,
  ZOMBIE_SPAWN_MAX_DISTANCE_M,
  ZOMBIE_SPAWN_MIN_DISTANCE_M,
} from "./constants";
import type { GameFacility, Player, Zombie } from "./entities";
import { Zombie as ZombieClass } from "./entities";
import { haversineDistance } from "./geo";
import { isValidPosition } from "./roadValidation";
import type { InputState, JoystickVector, LatLng, WalkLine } from "./types";

export interface SpawnZombiesInput {
  dt: number;
  zombieSpawnTimer: number;
  player: Player;
  zombies: Zombie[];
  walkLines: WalkLine[];
  map: L.Map;
  isValid: (lat: number, lng: number) => boolean;
}

export interface SpawnZombiesResult {
  zombies: Zombie[];
  zombieSpawnTimer: number;
}

export function spawnZombies(input: SpawnZombiesInput): SpawnZombiesResult {
  let { zombieSpawnTimer, zombies, player, walkLines, map, isValid } = input;
  zombieSpawnTimer += input.dt;

  if (zombieSpawnTimer <= ZOMBIE_SPAWN_INTERVAL_MS || zombies.length >= ZOMBIE_MAX_COUNT) {
    return { zombies, zombieSpawnTimer };
  }

  zombieSpawnTimer = 0;
  let isValidSpawn = false;
  let spawnLat = player.lat;
  let spawnLng = player.lng;

  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distMeters =
      ZOMBIE_SPAWN_MIN_DISTANCE_M +
      Math.random() * (ZOMBIE_SPAWN_MAX_DISTANCE_M - ZOMBIE_SPAWN_MIN_DISTANCE_M);
    spawnLat = player.lat + (Math.sin(angle) * distMeters) / 111111;
    spawnLng =
      player.lng +
      (Math.cos(angle) * distMeters) /
        (111111 * Math.cos((player.lat * Math.PI) / 180));

    if (isValid(spawnLat, spawnLng)) {
      isValidSpawn = true;
      break;
    }
  }

  if (!isValidSpawn && walkLines.length > 0) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const line = walkLines[Math.floor(Math.random() * walkLines.length)];
      const dist = haversineDistance(player.latlng, line.p1);
      if (dist > 80 && dist < 250) {
        spawnLat = line.p1.lat;
        spawnLng = line.p1.lng;
        isValidSpawn = true;
        break;
      }
    }
  }

  if (isValidSpawn) {
    zombies = [...zombies, new ZombieClass(spawnLat, spawnLng, map)];
  }

  return { zombies, zombieSpawnTimer };
}

export interface UpdateGameLoopInput {
  dt: number;
  playing: boolean;
  player: Player;
  keys: InputState;
  joystick: JoystickVector;
  zombies: Zombie[];
  facilities: GameFacility[];
  walkLines: WalkLine[];
  walkPolygons: LatLng[][];
  endLatLng: LatLng;
  map: L.Map;
  globalSirenActive: boolean;
  globalSirenTimer: number;
  zombieSpawnTimer: number;
}

export interface UpdateGameLoopResult {
  zombies: Zombie[];
  globalSirenActive: boolean;
  globalSirenTimer: number;
  zombieSpawnTimer: number;
  distToHome: number;
  victory: boolean;
}

export function updateGameLoop(input: UpdateGameLoopInput): UpdateGameLoopResult {
  const {
    dt,
    playing,
    player,
    keys,
    joystick,
    facilities,
    walkLines,
    walkPolygons,
    endLatLng,
    map,
  } = input;

  let { zombies, globalSirenActive, globalSirenTimer, zombieSpawnTimer } = input;

  if (!playing) {
    return {
      zombies,
      globalSirenActive,
      globalSirenTimer,
      zombieSpawnTimer,
      distToHome: haversineDistance(player.latlng, endLatLng),
      victory: false,
    };
  }

  if (globalSirenActive) {
    globalSirenTimer -= dt;
    if (globalSirenTimer <= 0) {
      globalSirenActive = false;
      globalSirenTimer = 0;
    }
  }

  const isValid = (lat: number, lng: number) =>
    isValidPosition(lat, lng, walkLines, walkPolygons);

  player.update(dt, keys, joystick, playing);
  facilities.forEach((f) => f.update(dt));

  const spawnResult = spawnZombies({
    dt,
    zombieSpawnTimer,
    player,
    zombies,
    walkLines,
    map,
    isValid,
  });
  zombies = spawnResult.zombies;
  zombieSpawnTimer = spawnResult.zombieSpawnTimer;

  zombies.forEach((z) =>
    z.update(dt, player, facilities, globalSirenActive, isValid),
  );

  const distToHome = haversineDistance(player.latlng, endLatLng);
  const victory = distToHome < WIN_DISTANCE_M;

  return {
    zombies,
    globalSirenActive,
    globalSirenTimer,
    zombieSpawnTimer,
    distToHome,
    victory,
  };
}