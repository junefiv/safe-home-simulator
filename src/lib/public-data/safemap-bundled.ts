import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedFacility } from "@/lib/game/types";

const CACHE_DIR = join(process.cwd(), ".cache");

const LIGHTS_PATH = join(CACHE_DIR, "security-lights.json");
const CCTV_PATH = join(CACHE_DIR, "cctv-stations.json");
const STORE_PATH = join(CACHE_DIR, "convenience-stores.json");
const BELL_PATH = join(CACHE_DIR, "emergency-bells.json");
const POLICE_PATH = join(CACHE_DIR, "police-stations.json");

async function readCacheJson(path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

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

function loadCached(
  path: string,
  type: NormalizedFacility["type"],
  label: string,
  cache: { value: NormalizedFacility[] | null },
  promise: { current: Promise<NormalizedFacility[]> | null },
): Promise<NormalizedFacility[]> {
  if (cache.value) return Promise.resolve(cache.value);
  if (!promise.current) {
    promise.current = readCacheJson(path).then((data) => {
      cache.value = asFacilities(data, type);
      if (cache.value.length > 0) {
        console.log(`[facility] ${label} ${cache.value.length.toLocaleString()}건 로드`);
      }
      return cache.value;
    });
  }
  return promise.current;
}

const lightsState = { value: null as NormalizedFacility[] | null };
const lightsPromise = { current: null as Promise<NormalizedFacility[]> | null };
const cctvState = { value: null as NormalizedFacility[] | null };
const cctvPromise = { current: null as Promise<NormalizedFacility[]> | null };
const storeState = { value: null as NormalizedFacility[] | null };
const storePromise = { current: null as Promise<NormalizedFacility[]> | null };
const bellState = { value: null as NormalizedFacility[] | null };
const bellPromise = { current: null as Promise<NormalizedFacility[]> | null };
const policeState = { value: null as NormalizedFacility[] | null };
const policePromise = { current: null as Promise<NormalizedFacility[]> | null };

export async function getBundledLightFacilities(): Promise<NormalizedFacility[]> {
  return loadCached(LIGHTS_PATH, "light", "보안등", lightsState, lightsPromise);
}

export async function getBundledCctvFacilities(): Promise<NormalizedFacility[]> {
  return loadCached(CCTV_PATH, "cctv", "CCTV", cctvState, cctvPromise);
}

export async function getBundledStoreFacilities(): Promise<NormalizedFacility[]> {
  return loadCached(STORE_PATH, "store", "편의점", storeState, storePromise);
}

export async function getBundledBellFacilities(): Promise<NormalizedFacility[]> {
  return loadCached(BELL_PATH, "bell", "안전비상벨", bellState, bellPromise);
}

export async function getBundledPoliceFacilities(): Promise<NormalizedFacility[]> {
  return loadCached(POLICE_PATH, "police", "파출소/지구대", policeState, policePromise);
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

export async function getBundledStoreSource(): Promise<SafemapBundledSource> {
  const rows = await getBundledStoreFacilities();
  return rows.length > 0 ? "bundled-json" : "empty";
}
