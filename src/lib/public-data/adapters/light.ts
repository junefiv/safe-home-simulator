import type { NormalizedFacility } from "../types";
import { getBundledLightFacilities } from "../safemap-bundled";

/** 전국 보안등 — src/data/security-lights.json (npm run build:safemap-facilities) */
export async function fetchLightFacilities(): Promise<NormalizedFacility[]> {
  return getBundledLightFacilities();
}
