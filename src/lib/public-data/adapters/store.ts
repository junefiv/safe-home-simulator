import type { NormalizedFacility } from "../types";
import { getBundledStoreFacilities } from "../safemap-bundled";

/** 전국 편의점 — .cache/convenience-stores.json (npm run build:convenience-stores) */
export async function fetchStoreFacilities(): Promise<NormalizedFacility[]> {
  return getBundledStoreFacilities();
}
