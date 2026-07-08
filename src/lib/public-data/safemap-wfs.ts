import type { Bbox } from "@/lib/game/types";
import { bboxWgs84To3857, epsg3857ToWgs84 } from "./coord";

export const SAFEMAP_WFS_URL = "https://www.safemap.go.kr/geoserver_pos/wfs";
export const WFS_MAX_FEATURES = 2000;

export interface WfsGeoJsonFeature {
  id?: string;
  geometry?: { type: string; coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

interface WfsGeoJsonCollection {
  features?: WfsGeoJsonFeature[];
}

function parseWfsErrorXml(text: string): string | null {
  const match = text.match(/<ows:ExceptionText>([^<]+)<\/ows:ExceptionText>/);
  return match?.[1]?.trim() ?? null;
}

async function fetchWfsLayer(
  serviceKey: string,
  typeName: string,
  bbox: Bbox,
  maxFeatures: number,
  cqlFilter?: string,
): Promise<WfsGeoJsonFeature[]> {
  const url = new URL(SAFEMAP_WFS_URL);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "1.1.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeName", typeName);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:3857");
  url.searchParams.set("bbox", `${bboxWgs84To3857(bbox)},EPSG:3857`);
  url.searchParams.set("maxFeatures", String(maxFeatures));
  if (cqlFilter) url.searchParams.set("CQL_FILTER", cqlFilter);

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("xml") || text.startsWith("<?xml")) {
    const detail = parseWfsErrorXml(text);
    throw new Error(detail ?? `WFS XML 오류 (${typeName})`);
  }

  const data = JSON.parse(text) as WfsGeoJsonCollection;
  return data.features ?? [];
}

/** geoserver_pos WFS — typeName 후보를 순서대로 시도 */
export async function fetchSafemapWfsFeatures(
  serviceKey: string,
  typeNames: string[],
  bbox: Bbox,
  label: string,
  maxFeatures = WFS_MAX_FEATURES,
  cqlFilter?: string,
): Promise<WfsGeoJsonFeature[]> {
  let lastError = `${label} WFS 레이어를 찾을 수 없습니다`;

  for (const typeName of typeNames) {
    try {
      const features = await fetchWfsLayer(
        serviceKey,
        typeName,
        bbox,
        maxFeatures,
        cqlFilter,
      );
      if (features.length >= maxFeatures) {
        console.warn(
          `[${label}] WFS maxFeatures(${maxFeatures}) 도달 — 구간 내 시설이 더 있을 수 있습니다.`,
        );
      }
      return features;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!lastError.includes("unknown") && !lastError.includes("Unknown")) {
        throw err instanceof Error ? err : new Error(lastError);
      }
    }
  }

  throw new Error(
    `${lastError}. 생활안전지도 > 오픈API My Data에 '${label}' 사용신청·승인이 필요할 수 있습니다.`,
  );
}

export function wfsPointToWgs84(feature: WfsGeoJsonFeature): { lat: number; lng: number } | null {
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return epsg3857ToWgs84(coords[0], coords[1]);
}

export function wfsPropsToFacilityFields(
  feature: WfsGeoJsonFeature,
  index: number,
  defaultName: string,
): { id: string; name: string; address: string } {
  const props = feature.properties ?? {};
  return {
    id: String(props.objt_id ?? props.gid ?? feature.id ?? `wfs-${index}`),
    name: String(
      props.cctv_nm ??
        props.fclty_nm ??
        props.fclty_ty ??
        props.name ??
        defaultName,
    ),
    address: String(props.rn_adres ?? props.adres ?? props.addr ?? ""),
  };
}
