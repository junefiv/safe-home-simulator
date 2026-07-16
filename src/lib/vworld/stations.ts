import type { Bbox, LatLng } from "@/lib/game/types";
import { fetchVworldFeatures } from "./data-client";
import {
  featuresToStationPolygons,
  type GeoJsonFeature,
} from "./geojson";

const BUILDING_LAYER = "LT_C_BLDGINFO";

/** VWorld 건축물 중 역사·지하철역 폴리곤 */
export async function fetchVworldStationZones(bbox: Bbox): Promise<LatLng[][]> {
  const features = await fetchVworldFeatures(BUILDING_LAYER, bbox, 15);
  return featuresToStationPolygons(features as GeoJsonFeature[]);
}
