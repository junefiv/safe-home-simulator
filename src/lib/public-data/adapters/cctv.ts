import type { NormalizedFacility } from "../types";
import { getBundledCctvFacilities } from "../safemap-bundled";

/** 전국 CCTV — src/data/cctv-stations.json (npm run build:safemap-facilities) */
export async function fetchCctvFacilities(): Promise<NormalizedFacility[]> {
  return getBundledCctvFacilities();
}
