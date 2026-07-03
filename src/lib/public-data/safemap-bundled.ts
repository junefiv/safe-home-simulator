import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedFacility } from "@/lib/game/types";

const CACHE_DIR = join(process.cwd(), ".cache");
const LIGHTS_PATHS = [
  join(CACHE_DIR, "security-lights.json"),
  join(process.cwd(), "src/data/security-lights.json"),
];
const CCTV_PATHS = [
  join(CACHE_DIR, "cctv-stations.json"),
  join(process.cwd(), "src/data/cctv-stations.json"),
];

async function readFirstAvailable(paths: string[]): Promise<unknown> {
  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw);
    } catch {
      // try next path
    }
  }
  return [];
}

let lightsCache: NormalizedFacility[] | null = null;
let cctvCache: NormalizedFacility[] | null = null;
let lightsPromise: Promise<NormalizedFacility[]> | null = null;
let cctvPromise: Promise<NormalizedFacility[]> | null = null;

function asFacilities(data: unknown, type: NormalizedFacility["type"]): NormalizedFacility[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is NormalizedFacility =>
      Boolean(row) &&
      typeof row === "object" &&
      (row as NormalizedFacility).type === type &&
      typeof (row as NormalizedFacility).lat === "number" &&
      typeof (row as NormalizedFacility).lng === "number",
  );
}

export async function getBundledLightFacilities(): Promise<NormalizedFacility[]> {
  if (lightsCache) return lightsCache;
  if (!lightsPromise) {
    lightsPromise = readFirstAvailable(LIGHTS_PATHS).then((data) => {
      lightsCache = asFacilities(data, "light");
      if (lightsCache.length > 0) {
        console.log(`[safemap] 보안등 ${lightsCache.length.toLocaleString()}건 로드`);
      }
      return lightsCache;
    });
  }
  return lightsPromise;
}

export async function getBundledCctvFacilities(): Promise<NormalizedFacility[]> {
  if (cctvCache) return cctvCache;
  if (!cctvPromise) {
    cctvPromise = readFirstAvailable(CCTV_PATHS).then((data) => {
      cctvCache = asFacilities(data, "cctv");
      if (cctvCache.length > 0) {
        console.log(`[safemap] CCTV ${cctvCache.length.toLocaleString()}건 로드`);
      }
      return cctvCache;
    });
  }
  return cctvPromise;
}

export type SafemapBundledSource = "bundled-json" | "empty";

export async function getBundledLightSource(): Promise<SafemapBundledSource> {
  const rows = await getBundledLightFacilities();
  return rows.length > 0 ? "bundled-json" : "empty";
}

export async function getBundledCctvSource(): Promise<SafemapBundledSource> {
  const rows = await getBundledCctvFacilities();
  return rows.length > 0 ? "bundled-json" : "empty";
}
