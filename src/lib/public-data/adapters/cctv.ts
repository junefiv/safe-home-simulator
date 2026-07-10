import type { NormalizedFacility } from "../types";
import { getBundledCctvFacilities } from "../safemap-bundled";

/** 전국 CCTV — .cache/cctv-stations.json (npm run convert:facility-csv) */
export async function fetchCctvFacilities(): Promise<NormalizedFacility[]> {
  return getBundledCctvFacilities();
}
