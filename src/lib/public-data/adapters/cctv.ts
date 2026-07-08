import type { NormalizedFacility } from "../types";
import { getCctvCsvFacilities } from "../cctv-csv";

/** 전국 CCTV — src/data/cctv-stations.json (npm run build:safemap-facilities) */
export async function fetchCctvFacilities(): Promise<NormalizedFacility[]> {
  return getCctvCsvFacilities();
}
