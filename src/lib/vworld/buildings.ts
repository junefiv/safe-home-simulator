import type { Bbox, LatLng } from "@/lib/game/types";
import { bboxWgs84To3857 } from "@/lib/public-data/coord";
import { resolveVworldApiKey, resolveVworldDomain } from "./config";
import { featuresToBlockPolygons, type GeoJsonFeature } from "./geojson";

const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";
const BUILDING_LAYER = "LT_C_BLDGINFO";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

interface VworldDataResponse {
  response?: {
    status?: string;
    error?: { code?: string; text?: string };
    result?: {
      featureCollection?: {
        features?: {
          geometry?: { type?: string; coordinates?: unknown };
          properties?: Record<string, unknown>;
        }[];
      };
    };
  };
}

function bboxToGeomFilter(bbox: Bbox, crs: "EPSG:4326" | "EPSG:3857"): string {
  if (crs === "EPSG:4326") {
    return `BOX(${bbox.west},${bbox.south},${bbox.east},${bbox.north})`;
  }
  return `BOX(${bboxWgs84To3857(bbox)})`;
}

async function fetchBuildingPage(
  bbox: Bbox,
  page: number,
  apiKey: string,
  domain: string,
): Promise<VworldDataResponse> {
  const url = new URL(VWORLD_DATA_URL);
  url.searchParams.set("service", "data");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("request", "getfeature");
  url.searchParams.set("data", BUILDING_LAYER);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("domain", domain);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("geometry", "true");
  url.searchParams.set("attribute", "true");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("geomFilter", bboxToGeomFilter(bbox, "EPSG:4326"));

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`VWorld 건물 HTTP ${res.status}`);
  }
  return (await res.json()) as VworldDataResponse;
}

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
  const apiKey = resolveVworldApiKey();
  if (!apiKey) {
    throw new VworldApiError("VWORLD_API_KEY가 없습니다");
  }

  const domain = resolveVworldDomain();
  const allFeatures: GeoJsonFeature[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const json = await fetchBuildingPage(bbox, page, apiKey, domain);
    const status = json.response?.status;

    if (status === "ERROR") {
      const err = json.response?.error;
      throw new VworldApiError(
        `${err?.text ?? "VWorld 건물 API 오류"} (domain=${domain} — 개발자센터 서비스URL과 VWORLD_DOMAIN이 같아야 합니다)`,
        err?.code,
      );
    }

    if (status !== "OK") break;

    const features = json.response?.result?.featureCollection?.features ?? [];
    if (features.length === 0) break;

    allFeatures.push(...(features as GeoJsonFeature[]));
    if (features.length < PAGE_SIZE) break;
  }

  return featuresToBlockPolygons(allFeatures);
}
