import type { NormalizedFacility } from "@/lib/game/types";
import { getBundledBellFacilities } from "./safemap-bundled";

/** 전국 안전비상벨 — .cache/emergency-bells.json (npm run convert:facility-csv) */
export function getEmergencyBellFacilities(): Promise<NormalizedFacility[]> {
  return getBundledBellFacilities();
}
