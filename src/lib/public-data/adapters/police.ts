import type { NormalizedFacility } from "../types";
import { getBundledPoliceFacilities } from "../safemap-bundled";

/** 전국 파출소·지구대 — .cache/police-stations.json (npm run build:police-stations) */
export async function fetchPoliceFacilities(): Promise<NormalizedFacility[]> {
  return getBundledPoliceFacilities();
}
