import {
  ZOMBIE_SPAWN_MAX_DISTANCE_M,
  ZOMBIE_SPAWN_MIN_DISTANCE_M,
} from "./constants";
import { haversineDistance } from "./geo";
import type { LatLng, WalkLine } from "./types";

export interface ZombieSpawnInput {
  player: LatLng;
  walkLines: WalkLine[];
  isValid: (lat: number, lng: number) => boolean;
}

/** 기존 좀비 스폰과 동일한 위치 탐색 — 플레이어 기준 80~150m */
export function findZombieSpawnPosition(input: ZombieSpawnInput): LatLng | null {
  const { player, walkLines, isValid } = input;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distMeters =
      ZOMBIE_SPAWN_MIN_DISTANCE_M +
      Math.random() * (ZOMBIE_SPAWN_MAX_DISTANCE_M - ZOMBIE_SPAWN_MIN_DISTANCE_M);
    const lat = player.lat + (Math.sin(angle) * distMeters) / 111111;
    const lng =
      player.lng +
      (Math.cos(angle) * distMeters) /
        (111111 * Math.cos((player.lat * Math.PI) / 180));

    if (isValid(lat, lng)) {
      return { lat, lng };
    }
  }

  if (walkLines.length > 0) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const line = walkLines[Math.floor(Math.random() * walkLines.length)];
      const dist = haversineDistance(player, line.p1);
      if (dist < ZOMBIE_SPAWN_MIN_DISTANCE_M || dist > ZOMBIE_SPAWN_MAX_DISTANCE_M + 80) {
        continue;
      }
      if (isValid(line.p1.lat, line.p1.lng)) {
        return { lat: line.p1.lat, lng: line.p1.lng };
      }
    }
  }

  return null;
}
