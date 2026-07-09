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
import type { MovementResolver } from "./roadValidation";
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
  const { player, walkLines, map, isValid } = input;
  let { zombieSpawnTimer, zombies } = input;
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
    zombies = [
      ...zombies,
      new ZombieClass(spawnLat, spawnLng, map, player.movementLayer),
    ];
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
  subwayLines: WalkLine[];
  movement: MovementResolver;
  playerSpeedMultiplier: number;
  endLatLng: LatLng;
  map: L.Map;
  globalSirenActive: boolean;
  globalSirenTimer: number;
  globalStunActive: boolean;
  globalStunTimer: number;
  zombieSpawnTimer: number;
}

export interface UpdateGameLoopResult {
  zombies: Zombie[];
  globalSirenActive: boolean;
  globalSirenTimer: number;
  globalStunActive: boolean;
  globalStunTimer: number;
  zombieSpawnTimer: number;
  distToHome: number;
  victory: boolean;
}

const FACILITY_INDEX_CELL_DEG = 0.002;
const facilityIndexCache = new WeakMap<GameFacility[], Map<string, GameFacility[]>>();

function nearbyFacilities(point: LatLng, facilities: GameFacility[]): GameFacility[] {
  let index = facilityIndexCache.get(facilities);
  if (!index) {
    index = new Map<string, GameFacility[]>();
    for (const facility of facilities) {
      const row = Math.floor(facility.lat / FACILITY_INDEX_CELL_DEG);
      const col = Math.floor(facility.lng / FACILITY_INDEX_CELL_DEG);
      const key = `${row}:${col}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(facility);
      else index.set(key, [facility]);
    }
    facilityIndexCache.set(facilities, index);
  }

  const row = Math.floor(point.lat / FACILITY_INDEX_CELL_DEG);
  const col = Math.floor(point.lng / FACILITY_INDEX_CELL_DEG);
  const result: GameFacility[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const bucket = index.get(`${row + dr}:${col + dc}`);
      if (bucket) result.push(...bucket);
    }
  }
  return result;
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
    subwayLines,
    movement,
    playerSpeedMultiplier,
    endLatLng,
    map,
  } = input;

  let {
    zombies,
    globalSirenActive,
    globalSirenTimer,
    globalStunActive,
    globalStunTimer,
    zombieSpawnTimer,
  } = input;

  if (!playing) {
    return {
      zombies,
      globalSirenActive,
      globalSirenTimer,
      globalStunActive,
      globalStunTimer,
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

  if (globalStunActive) {
    globalStunTimer -= dt;
    if (globalStunTimer <= 0) {
      globalStunActive = false;
      globalStunTimer = 0;
    }
  }

  const isValid = (lat: number, lng: number) =>
    movement.isValid({ lat, lng }, player.movementLayer);

  const playerNearbyFacilities = nearbyFacilities(player.latlng, facilities);
  for (const facility of playerNearbyFacilities) {
    facility.touch(player.latlng, playing);
  }
  player.update(
    dt,
    keys,
    joystick,
    playing,
    movement,
    playerSpeedMultiplier,
  );
  for (const facility of facilities) {
    if (facility.type === "bell") facility.update(dt);
    else if (facility.type === "store") {
      facility.updateStore(dt, player.latlng, playing);
    }
  }

  const spawnResult = spawnZombies({
    dt,
    zombieSpawnTimer,
    player,
    zombies,
    walkLines: player.movementLayer === "underground" ? subwayLines : walkLines,
    map,
    isValid,
  });
  zombies = spawnResult.zombies;
  zombieSpawnTimer = spawnResult.zombieSpawnTimer;

  zombies.forEach((z) =>
    z.update(
      dt,
      player,
      nearbyFacilities(z.latlng, facilities),
      globalSirenActive,
      globalStunActive,
      movement,
    ),
  );

  const distToHome = haversineDistance(player.latlng, endLatLng);
  const victory = distToHome < WIN_DISTANCE_M;

  return {
    zombies,
    globalSirenActive,
    globalSirenTimer,
    globalStunActive,
    globalStunTimer,
    zombieSpawnTimer,
    distToHome,
    victory,
  };
}
