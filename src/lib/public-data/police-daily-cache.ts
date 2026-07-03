import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedFacility } from "@/lib/game/types";
import { POLICE_CACHE_TTL_MS } from "@/lib/game/constants";

export interface PoliceDailyCache {
  fetchedAt: number;
  facilities: NormalizedFacility[];
}

const CACHE_DIR = join(process.cwd(), ".cache");
const CACHE_FILE = join(CACHE_DIR, "police-stations-daily.json");

export function isPoliceCacheFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < POLICE_CACHE_TTL_MS;
}

export async function readPoliceDailyCache(): Promise<PoliceDailyCache | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PoliceDailyCache;
    if (!parsed.fetchedAt || !Array.isArray(parsed.facilities)) return null;
    if (!isPoliceCacheFresh(parsed.fetchedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writePoliceDailyCache(
  facilities: NormalizedFacility[],
): Promise<void> {
  const payload: PoliceDailyCache = {
    fetchedAt: Date.now(),
    facilities,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
}
