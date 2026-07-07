import { resolveVworldApiKey, resolveVworldDomain } from "./config";

const VWORLD_WMS_URL = "https://api.vworld.kr/req/wms";

export type VworldMapLayer = "Base" | "Hybrid" | "Satellite";

/** Leaflet XYZ 타일 → EPSG:3857 bbox */
export function tileBbox3857(z: number, x: number, y: number): [number, number, number, number] {
  const world = 20037508.34;
  const n = 2 ** z;
  const tile = (world * 2) / n;
  const minX = -world + x * tile;
  const maxX = minX + tile;
  const maxY = world - y * tile;
  const minY = maxY - tile;
  return [minX, minY, maxX, maxY];
}

export function buildVworldWmsTileUrl(
  z: number,
  x: number,
  y: number,
  layer: VworldMapLayer = "Hybrid",
): string {
  const key = resolveVworldApiKey();
  const domain = resolveVworldDomain();
  const [minX, minY, maxX, maxY] = tileBbox3857(z, x, y);

  const url = new URL(VWORLD_WMS_URL);
  url.searchParams.set("service", "WMS");
  url.searchParams.set("request", "GetMap");
  url.searchParams.set("version", "1.3.0");
  url.searchParams.set("layers", layer);
  url.searchParams.set("styles", layer === "Base" ? "default" : "");
  url.searchParams.set("format", "image/png");
  url.searchParams.set("transparent", layer === "Base" ? "false" : "true");
  url.searchParams.set("width", "256");
  url.searchParams.set("height", "256");
  url.searchParams.set("crs", "EPSG:3857");
  url.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY}`);
  url.searchParams.set("key", key);
  url.searchParams.set("domain", domain);

  return url.toString();
}

export async function fetchVworldTilePng(
  z: number,
  x: number,
  y: number,
  layer: VworldMapLayer = "Hybrid",
): Promise<ArrayBuffer | null> {
  if (!resolveVworldApiKey()) return null;

  const res = await fetch(buildVworldWmsTileUrl(z, x, y, layer), {
    cache: "force-cache",
    signal: AbortSignal.timeout(12_000),
  });

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("image")) return null;

  return res.arrayBuffer();
}
