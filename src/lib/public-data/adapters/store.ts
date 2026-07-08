import type { Bbox, NormalizedFacility } from "@/lib/game/types";
import {
  fetchSafemapWfsFeatures,
  wfsPointToWgs84,
  wfsPropsToFacilityFields,
} from "../safemap-wfs";

const STORE_LAYERS = ["A2SM_CMMNPOI", "safemap:A2SM_CMMNPOI"];

export async function fetchStoreFacilities(
  serviceKey: string,
  bbox: Bbox,
): Promise<NormalizedFacility[]> {
  if (!serviceKey) return [];
  const features = await fetchSafemapWfsFeatures(
    serviceKey,
    STORE_LAYERS,
    bbox,
    "편의점",
    2000,
  );

  return features.flatMap((feature, index) => {
    const props = feature.properties ?? {};
    const category = `${props.fclty_ty ?? ""} ${props.fclty_nm ?? ""}`;
    if (!/편의점|CU|GS25|세븐일레븐|이마트24|미니스톱/i.test(category)) return [];
    const coord = wfsPointToWgs84(feature);
    if (!coord) return [];
    const fields = wfsPropsToFacilityFields(feature, index, "편의점");
    return [{ ...fields, id: `store-${fields.id}`, type: "store" as const, ...coord }];
  });
}
