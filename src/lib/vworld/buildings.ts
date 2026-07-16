import type { Bbox, LatLng } from "@/lib/game/types";
import { fetchVworldFeatures } from "./data-client";
import { featuresToBlockPolygons, type GeoJsonFeature } from "./geojson";

const BUILDING_LAYER = "LT_C_BLDGINFO";

export class VworldApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "VworldApiError";
  }
}

/** VWorld 2D데이터 API — LT_C_BLDGINFO (국가 건축물) */
export async function fetchVworldBuildings(bbox: Bbox): Promise<LatLng[][]> {
  const features = await fetchVworldFeatures(BUILDING_LAYER, bbox);
  return featuresToBlockPolygons(features as GeoJsonFeature[]);
}
