/**
 * 생활안전지도 WFS → security-lights.json, convenience-stores.json 생성
 * (CCTV·비상벨은 .cache CSV → npm run convert:facility-csv)
 *
 *   npm run build:safemap-facilities          # 보안등 + 편의점
 *   npm run build:convenience-stores          # 편의점만
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import proj4 from "proj4";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../.cache");
const OUT_LIGHTS = join(CACHE_DIR, "security-lights.json");
const OUT_STORES = join(CACHE_DIR, "convenience-stores.json");

const WFS_URL = "https://www.safemap.go.kr/geoserver_pos/wfs";
const MAX_FEATURES = 2000;
const MIN_CELL_DEG = 0.06;
const GRID_STEP = 0.35;

const KOREA = { south: 33.0, north: 38.65, west: 124.5, east: 132.1 };

const LAYERS = {
  light: ["A2SM_CMMNPOI_SECULIGHT", "safemap:A2SM_CMMNPOI_SECULIGHT"],
  store: ["A2SM_CMMNPOI", "safemap:A2SM_CMMNPOI"],
};

const STORE_NAME_RE = /편의점|CU|GS25|세븐일레븐|이마트24|미니스톱/i;

const targetArg = process.argv[2]?.trim().toLowerCase();
const targets = new Set(
  targetArg && targetArg !== "all"
    ? [targetArg]
    : ["lights", "stores"],
);

const serviceKeyRaw = process.env.SAFEMAP_SERVICE_KEY?.trim() ?? "";
const serviceKey = serviceKeyRaw.includes("%")
  ? decodeURIComponent(serviceKeyRaw)
  : serviceKeyRaw;

if (!serviceKey) {
  console.error("SAFEMAP_SERVICE_KEY가 필요합니다 (.env.local)");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function to3857Bbox(south, west, north, east) {
  const toX = (lng) => (lng * 20037508.34) / 180;
  const toY = (lat) =>
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.34 / 180);
  return `${toX(west)},${toY(south)},${toX(east)},${toY(north)}`;
}

function toWgs84(x, y) {
  const [lng, lat] = proj4("EPSG:3857", "WGS84", [x, y]);
  return { lat, lng };
}

function* gridCells(bounds, step) {
  for (let lat = bounds.south; lat < bounds.north - 1e-9; lat += step) {
    for (let lng = bounds.west; lng < bounds.east - 1e-9; lng += step) {
      yield {
        south: lat,
        north: Math.min(lat + step, bounds.north),
        west: lng,
        east: Math.min(lng + step, bounds.east),
      };
    }
  }
}

async function fetchWfsCell(typeNames, south, west, north, east) {
  let lastError = "unknown layer";
  for (const typeName of typeNames) {
    const url = new URL(WFS_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("version", "1.1.0");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typeName", typeName);
    url.searchParams.set("outputFormat", "application/json");
    url.searchParams.set("srsName", "EPSG:3857");
    url.searchParams.set("bbox", `${to3857Bbox(south, west, north, east)},EPSG:3857`);
    url.searchParams.set("maxFeatures", String(MAX_FEATURES));

    const res = await fetch(url.toString());
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();

    if (ct.includes("xml") || text.startsWith("<?xml")) {
      const m = text.match(/<ows:ExceptionText>([^<]+)<\/ows:ExceptionText>/);
      lastError = m?.[1] ?? "WFS XML error";
      if (lastError.toLowerCase().includes("unknown")) continue;
      throw new Error(lastError);
    }

    try {
      const json = JSON.parse(text);
      return json.features ?? [];
    } catch {
      throw new Error(`JSON 파싱 실패 (${typeName}, 셀 ${south.toFixed(2)},${west.toFixed(2)})`);
    }
  }
  throw new Error(lastError);
}

async function fetchCellRecursive(typeNames, south, west, north, east, depth = 0) {
  try {
    const features = await fetchWfsCell(typeNames, south, west, north, east);
    const span = Math.max(north - south, east - west);
    if (features.length >= MAX_FEATURES && span > MIN_CELL_DEG && depth < 6) {
      const midLat = (south + north) / 2;
      const midLng = (west + east) / 2;
      const quads = [
        [south, west, midLat, midLng],
        [south, midLng, midLat, east],
        [midLat, west, north, midLng],
        [midLat, midLng, north, east],
      ];
      const merged = [];
      for (const [s, w, n, e] of quads) {
        merged.push(...(await fetchCellRecursive(typeNames, s, w, n, e, depth + 1)));
        await sleep(80);
      }
      return merged;
    }
    return features;
  } catch (err) {
    const span = Math.max(north - south, east - west);
    if (span > MIN_CELL_DEG && depth < 6) {
      const midLat = (south + north) / 2;
      const midLng = (west + east) / 2;
      const quads = [
        [south, west, midLat, midLng],
        [south, midLng, midLat, east],
        [midLat, west, north, midLng],
        [midLat, midLng, north, east],
      ];
      const merged = [];
      for (const [s, w, n, e] of quads) {
        merged.push(...(await fetchCellRecursive(typeNames, s, w, n, e, depth + 1)));
        await sleep(80);
      }
      return merged;
    }
    throw err;
  }
}

function featureToFacility(feature, type, defaultName, idPrefix) {
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const { lat, lng } = toWgs84(coords[0], coords[1]);
  const p = feature.properties ?? {};
  const objtId = p.objt_id ?? p.gid ?? feature.id;
  if (objtId == null) return null;
  return {
    id: `${idPrefix}-${objtId}`,
    type,
    lat,
    lng,
    name: String(p.fclty_nm ?? p.cctv_nm ?? p.fclty_ty ?? defaultName),
    address: String(p.rn_adres ?? p.adres ?? ""),
  };
}

function featureToStoreFacility(feature) {
  const p = feature.properties ?? {};
  const category = `${p.fclty_ty ?? ""} ${p.fclty_nm ?? ""}`;
  if (!STORE_NAME_RE.test(category)) return null;
  return featureToFacility(feature, "store", "편의점", "store");
}

async function collectNationwide(label, typeNames, mapFeature) {
  const seen = new Map();
  const cells = [...gridCells(KOREA, GRID_STEP)];
  console.log(`\n[${label}] 격자 ${cells.length}칸 수집...`);

  try {
    for (let i = 0; i < cells.length; i++) {
      const { south, west, north, east } = cells[i];
      const features = await fetchCellRecursive(typeNames, south, west, north, east);
      for (const f of features) {
        const row = mapFeature(f);
        if (row) seen.set(row.id, row);
      }
      if ((i + 1) % 10 === 0 || i === cells.length - 1) {
        console.log(`[${label}] ${i + 1}/${cells.length}칸, 누적 ${seen.size}건`);
      }
      await sleep(100);
    }
  } catch (err) {
    console.warn(`[${label}] 수집 중단:`, err.message);
  }

  return [...seen.values()];
}

mkdirSync(CACHE_DIR, { recursive: true });

if (targets.has("lights")) {
  const lights = await collectNationwide(
    "보안등",
    LAYERS.light,
    (f) => featureToFacility(f, "light", "보안등", "light"),
  );
  writeFileSync(OUT_LIGHTS, JSON.stringify(lights, null, 2), "utf8");
  console.log(`\n저장: ${OUT_LIGHTS} (${lights.length}건)`);
}

if (targets.has("stores")) {
  const stores = await collectNationwide(
    "편의점",
    LAYERS.store,
    featureToStoreFacility,
  );
  writeFileSync(OUT_STORES, JSON.stringify(stores, null, 2), "utf8");
  console.log(`\n저장: ${OUT_STORES} (${stores.length}건)`);
}
