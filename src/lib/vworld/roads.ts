import type { Bbox } from "@/lib/game/types";
import { ROAD_SEGMENT_TOLERANCE_M } from "@/lib/game/constants";
import { fetchVworldFeatures } from "./data-client";
import { featuresToWalkLines } from "./geojson";

/** VWorld 새주소 도로중심선 */
const ROAD_CENTERLINE_LAYER = "LT_L_SPRD";

function estimateVworldRoadHalfWidthM(props?: Record<string, unknown>): number {
  const widthKeys = ["road_bt", "ROAD_BT", "road_bt_m", "bt"];
  for (const key of widthKeys) {
    const widthM = Number(props?.[key]);
    if (!Number.isNaN(widthM) && widthM > 0) {
      return Math.max(widthM / 2 + 2, 8);
    }
  }

  const cls = String(
    props?.roa_cls_se ?? props?.ROA_CLS_SE ?? props?.roa_cls_cd ?? props?.ROA_CLS_CD ?? "",
  );

  if (/고속|0101|101|0{2,3}1/.test(cls)) return 36;
  if (/국도|0201|002/.test(cls)) return 28;
  if (/특별|광역|지원|0301|003/.test(cls)) return 24;
  if (/지방|일반|0401|004/.test(cls)) return 18;
  if (/세로|이면돌|골목|0601|0701|0801|005|006|007/.test(cls)) return 11;

  const roadName = String(props?.rn ?? props?.RN ?? "");
  if (/길$|로$/.test(roadName) && roadName.length <= 12) return 12;

  return ROAD_SEGMENT_TOLERANCE_M;
}

/** VWorld 2D데이터 — 도로중심선(LT_L_SPRD) */
export async function fetchVworldRoads(bbox: Bbox) {
  const features = await fetchVworldFeatures(ROAD_CENTERLINE_LAYER, bbox);
  return featuresToWalkLines(features, estimateVworldRoadHalfWidthM);
}
