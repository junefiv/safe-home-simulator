import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, ".cache");
const BBOX_CONFIG_PATH = join(CACHE_DIR, "map-cache-bboxes.json");
const PROGRESS_PATH = join(CACHE_DIR, "map-cache-progress.json");
const SHARD_DIR = join(CACHE_DIR, "map-cache");
const INDEX_PATH = join(SHARD_DIR, "index.json");
const ROADS_SHARD_DIR = join(SHARD_DIR, "roads");
const BUILDINGS_SHARD_DIR = join(SHARD_DIR, "buildings");

/** 한반도 대략 범위 (제주·울릉 포함) */
const KOREA = { south: 33.0, north: 38.65, west: 124.5, east: 132.1 };
/** 격자 한 칸 크기(도). 0.2° ≈ 22km */
const GRID_STEP = Number(process.env.MAP_CACHE_GRID_STEP ?? 0.2);
/** 한 번 실행에 처리할 칸 수 (매일 돌리기용) */
const BATCH_SIZE = Math.max(1, Number(process.env.MAP_CACHE_BATCH ?? 5));
/** 칸 사이 대기(ms) — API 부하 완화 */
const CELL_GAP_MS = Math.max(0, Number(process.env.MAP_CACHE_GAP_MS ?? 2000));
/** 칸 실패 시 재시도 횟수 */
const CELL_RETRIES = Math.max(0, Number(process.env.MAP_CACHE_RETRIES ?? 2));
/** 용량 오류 시 자동 분할 깊이 (0=분할 안 함) */
const SPLIT_MAX_DEPTH = Math.max(0, Number(process.env.MAP_CACHE_SPLIT_DEPTH ?? 2));

const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";
const VWORLD_ROAD_LAYER = "LT_L_SPRD";
const VWORLD_BUILDING_LAYER = "LT_C_BLDGINFO";
const OVERPASS_SERVERS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const ROAD_SEGMENT_TOLERANCE_M = 14;
const ROAD_JUNCTION_SLACK_M = 8;
const ROAD_BRIDGE_MAX_M = 18;
const PAGE_SIZE = 1000;
const MAX_ROAD_PAGES = 30;
const MAX_BUILDING_PAGES = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  console.error(`지도 캐시 사용법

# 1) 전국 격자 생성 (최초 1회)
npm run build:map-cache:init

# 2) 매일/수시로 다음 칸들만 이어서 받기 (기본 5칸)
npm run build:map-cache

환경변수:
  MAP_CACHE_BATCH=5          한 번에 처리할 칸 수
  MAP_CACHE_GAP_MS=2000      칸 사이 대기(ms)
  MAP_CACHE_GRID_STEP=0.2    격자 크기(도)
  MAP_CACHE_RETRIES=2        칸 실패 시 재시도 횟수
  MAP_CACHE_SPLIT_DEPTH=2    용량 오류 시 4분할 최대 깊이
  MAP_CACHE_FORCE=1          이미 완료된 칸도 다시 받기
`);
}

function generateKoreaGrid(step = GRID_STEP) {
  const cells = [];
  let row = 0;
  for (let south = KOREA.south; south < KOREA.north - 1e-9; south += step, row += 1) {
    let col = 0;
    for (let west = KOREA.west; west < KOREA.east - 1e-9; west += step, col += 1) {
      cells.push({
        name: `r${row}-c${col}`,
        south: Number(south.toFixed(5)),
        west: Number(west.toFixed(5)),
        north: Number(Math.min(south + step, KOREA.north).toFixed(5)),
        east: Number(Math.min(west + step, KOREA.east).toFixed(5)),
      });
    }
  }
  return cells;
}

/** 작은 설정 파일용 (pretty) */
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * 대용량 샤드: 항목을 하나씩 stringify + gzip 스트림으로 저장.
 * 전체 JSON 문자열을 한 번에 만들지 않아 Invalid string length 를 피한다.
 */
async function writeGzipJsonStreaming(path, writeBody) {
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(path);
  gzip.pipe(out);

  const write = (chunk) =>
    new Promise((resolve, reject) => {
      const ok = gzip.write(chunk, "utf8");
      if (ok) resolve();
      else gzip.once("drain", resolve);
      gzip.once("error", reject);
    });

  try {
    await writeBody(write);
    gzip.end();
    await finished(out);
  } catch (err) {
    gzip.destroy();
    out.destroy();
    throw err;
  }
}

async function writeArrayField(write, items) {
  await write("[");
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) await write(",");
    await write(JSON.stringify(items[i]));
    if (i > 0 && i % 5000 === 0) {
      // 진행 하트비트 (대용량 칸)
      process.stdout.write(`\r[map-cache]   writing… ${i.toLocaleString()}/${items.length.toLocaleString()}   `);
    }
  }
  if (items.length >= 5000) process.stdout.write("\n");
  await write("]");
}

async function writeRoadsShard(path, roadsEntry) {
  const { bbox, roads } = roadsEntry;
  await writeGzipJsonStreaming(path, async (write) => {
    await write(`{"bbox":${JSON.stringify(bbox)},"roads":{`);
    await write(`"walkLines":`);
    await writeArrayField(write, roads.walkLines ?? []);
    await write(`,"subwayLines":`);
    await writeArrayField(write, roads.subwayLines ?? []);
    await write(`,"stationPolygons":`);
    await writeArrayField(write, roads.stationPolygons ?? []);
    await write(`,"walkPolygons":`);
    await writeArrayField(write, roads.walkPolygons ?? []);
    await write(`,"apartmentPolygons":`);
    await writeArrayField(write, roads.apartmentPolygons ?? []);
    await write(`,"blockPolygons":[]`);
    await write(`,"buildingCoverage":${JSON.stringify(roads.buildingCoverage ?? [bbox])}`);
    await write(`}}`);
  });
}

async function writeBuildingsShard(path, buildingsEntry) {
  const { bbox, blockPolygons } = buildingsEntry;
  await writeGzipJsonStreaming(path, async (write) => {
    await write(`{"bbox":${JSON.stringify(bbox)},"blockPolygons":`);
    await writeArrayField(write, blockPolygons ?? []);
    await write(`}`);
  });
}

function isOversizedError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /Invalid string length|Cannot create a string|allocation failed|heap|ENOMEM/i.test(msg);
}

function splitBbox(bbox) {
  const midLat = Number(((bbox.south + bbox.north) / 2).toFixed(5));
  const midLng = Number(((bbox.west + bbox.east) / 2).toFixed(5));
  return [
    { name: `${bbox.name}a`, south: bbox.south, west: bbox.west, north: midLat, east: midLng },
    { name: `${bbox.name}b`, south: bbox.south, west: midLng, north: midLat, east: bbox.east },
    { name: `${bbox.name}c`, south: midLat, west: bbox.west, north: bbox.north, east: midLng },
    { name: `${bbox.name}d`, south: midLat, west: midLng, north: bbox.north, east: bbox.east },
  ];
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureNationwideBboxes(force = false) {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(BBOX_CONFIG_PATH) && !force) {
    return parseBboxes();
  }
  const cells = generateKoreaGrid();
  writeJson(BBOX_CONFIG_PATH, cells);
  console.log(
    `[map-cache] 전국 격자 ${cells.length.toLocaleString()}칸 생성 → ${BBOX_CONFIG_PATH} (step=${GRID_STEP}°)`,
  );
  return cells;
}

function parseBboxes() {
  const raw = existsSync(BBOX_CONFIG_PATH)
    ? readFileSync(BBOX_CONFIG_PATH, "utf8")
    : process.env.MAP_CACHE_BBOXES;
  if (!raw) {
    usage();
    process.exit(1);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("bbox config must be an array");

  return parsed.map((row, index) => {
    const bbox = {
      name: String(row.name ?? `bbox-${index + 1}`),
      south: Number(row.south),
      west: Number(row.west),
      north: Number(row.north),
      east: Number(row.east),
    };
    if ([bbox.south, bbox.west, bbox.north, bbox.east].some((v) => Number.isNaN(v))) {
      throw new Error(`invalid bbox at index ${index}`);
    }
    return bbox;
  });
}

function loadProgress(total) {
  const prev = readJson(PROGRESS_PATH, null);
  return {
    total,
    completed: Array.isArray(prev?.completed) ? prev.completed : [],
    failed: prev?.failed && typeof prev.failed === "object" ? prev.failed : {},
    nextIndex: Number.isFinite(prev?.nextIndex) ? prev.nextIndex : 0,
    lastRunAt: prev?.lastRunAt ?? null,
    batchSize: BATCH_SIZE,
  };
}

function saveProgress(progress) {
  writeJson(PROGRESS_PATH, {
    ...progress,
    lastRunAt: new Date().toISOString(),
    batchSize: BATCH_SIZE,
  });
}

function loadIndex() {
  return readJson(INDEX_PATH, { generatedAt: null, cells: [] });
}

function saveIndex(index) {
  index.generatedAt = new Date().toISOString();
  writeJson(INDEX_PATH, index);
}

function upsertIndexCell(index, cellMeta) {
  const cells = index.cells ?? [];
  const i = cells.findIndex((c) => c.name === cellMeta.name);
  if (i >= 0) cells[i] = cellMeta;
  else cells.push(cellMeta);
  index.cells = cells;
}

function resolveVworldKey() {
  return (
    process.env.VWORLD_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_VWORLD_API_KEY?.trim() ||
    ""
  );
}

function resolveVworldDomain() {
  return process.env.VWORLD_DOMAIN?.trim() || "http://localhost:3000";
}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchVworldFeatures(layer, bbox, maxPages) {
  const key = resolveVworldKey();
  if (!key) throw new Error("VWORLD_API_KEY is required");

  const features = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(VWORLD_DATA_URL);
    url.searchParams.set("service", "data");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("request", "getfeature");
    url.searchParams.set("data", layer);
    url.searchParams.set("key", key);
    url.searchParams.set("domain", resolveVworldDomain());
    url.searchParams.set("format", "json");
    url.searchParams.set("size", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("geometry", "true");
    url.searchParams.set("attribute", "true");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set(
      "geomFilter",
      `BOX(${bbox.west},${bbox.south},${bbox.east},${bbox.north})`,
    );

    const json = await fetchJson(url, 30_000);
    const status = json.response?.status;
    if (status === "ERROR") {
      const err = json.response?.error;
      throw new Error(`${err?.text ?? "VWorld API error"} (${err?.code ?? "unknown"})`);
    }
    if (status !== "OK") break;

    const pageFeatures = json.response?.result?.featureCollection?.features ?? [];
    if (pageFeatures.length === 0) break;
    features.push(...pageFeatures);
    if (pageFeatures.length < PAGE_SIZE) break;
  }
  return features;
}

function latLngPadForMeters(_lat, meters) {
  return meters / 111111;
}

function makeWalkLine(p1, p2, maxDistM, highway, isBridge = false) {
  const segPad = latLngPadForMeters(p1.lat, maxDistM + ROAD_JUNCTION_SLACK_M);
  return {
    p1,
    p2,
    minLat: Math.min(p1.lat, p2.lat) - segPad,
    maxLat: Math.max(p1.lat, p2.lat) + segPad,
    minLng: Math.min(p1.lng, p2.lng) - segPad,
    maxLng: Math.max(p1.lng, p2.lng) + segPad,
    maxDistM,
    highway,
    isBridge,
  };
}

function estimateVworldRoadHalfWidthM(props = {}) {
  for (const key of ["road_bt", "ROAD_BT", "road_bt_m", "bt"]) {
    const widthM = Number(props[key]);
    if (!Number.isNaN(widthM) && widthM > 0) return Math.max(widthM / 2 + 2, 8);
  }
  return ROAD_SEGMENT_TOLERANCE_M;
}

function lineCoordsToLatLng(line) {
  return line.map(([lng, lat]) => ({ lat, lng }));
}

function featuresToWalkLines(features, estimateHalfWidth) {
  const lines = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry?.coordinates) continue;
    const maxDistM = estimateHalfWidth(feature.properties ?? {});
    const highway = String(feature.properties?.highway ?? feature.properties?.rn ?? feature.properties?.RN ?? "road");

    const parts =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];

    for (const part of parts) {
      const pts = lineCoordsToLatLng(part);
      for (let i = 0; i < pts.length - 1; i += 1) {
        lines.push(makeWalkLine(pts[i], pts[i + 1], maxDistM, highway));
      }
    }
  }
  return lines;
}

function geometryToPolygons(geometry) {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return outer?.length >= 3 ? [lineCoordsToLatLng(outer)] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((poly) => poly[0])
      .filter((outer) => outer?.length >= 3)
      .map(lineCoordsToLatLng);
  }
  return [];
}

function isStationFeature(feature) {
  const text = [
    feature.properties?.main_purps_nm,
    feature.properties?.etc_purps,
    feature.properties?.bldg_nm,
    feature.properties?.regstr_kind_nm,
  ].filter(Boolean).join(" ");
  return /station|subway/i.test(text);
}

function featuresToBlockPolygons(features) {
  return features.flatMap((feature) =>
    isStationFeature(feature) ? [] : geometryToPolygons(feature.geometry),
  );
}

function haversine(a, b) {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

function bridgeRoadGaps(walkLines) {
  const endpoints = [];
  for (const line of walkLines) {
    endpoints.push({ pt: line.p1, maxDistM: line.maxDistM, highway: line.highway });
    endpoints.push({ pt: line.p2, maxDistM: line.maxDistM, highway: line.highway });
  }
  if (endpoints.length < 2) return walkLines;

  const cellDeg = ROAD_BRIDGE_MAX_M / 111111;
  const grid = new Map();
  const cellKey = (lat, lng) => `${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`;

  for (const ep of endpoints) {
    const key = cellKey(ep.pt.lat, ep.pt.lng);
    const bucket = grid.get(key);
    if (bucket) bucket.push(ep);
    else grid.set(key, [ep]);
  }

  const bridges = [];
  const seen = new Set();
  for (const [key, bucket] of grid) {
    const [row, col] = key.split(":").map(Number);
    const neighbors = [...bucket];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const nearby = grid.get(`${row + dr}:${col + dc}`);
        if (nearby) neighbors.push(...nearby);
      }
    }
    for (const a of bucket) {
      for (const b of neighbors) {
        if (a === b) continue;
        const dist = haversine(a.pt, b.pt);
        if (dist < 0.8 || dist > ROAD_BRIDGE_MAX_M) continue;
        const pairKey =
          a.pt.lat < b.pt.lat || (a.pt.lat === b.pt.lat && a.pt.lng <= b.pt.lng)
            ? `${a.pt.lat.toFixed(6)}:${a.pt.lng.toFixed(6)}|${b.pt.lat.toFixed(6)}:${b.pt.lng.toFixed(6)}`
            : `${b.pt.lat.toFixed(6)}:${b.pt.lng.toFixed(6)}|${a.pt.lat.toFixed(6)}:${a.pt.lng.toFixed(6)}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        bridges.push(makeWalkLine(a.pt, b.pt, Math.max(a.maxDistM, b.maxDistM, ROAD_SEGMENT_TOLERANCE_M), a.highway ?? b.highway, true));
      }
    }
  }
  return bridges.length > 0 ? [...walkLines, ...bridges] : walkLines;
}

function buildRoadsQuery(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:20];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|service|residential|unclassified|tertiary|tertiary_link|road)$"](${b});
  way["railway"="subway"](${b});
  way["building"="train_station"](${b});
  way["railway"="station"](${b});
  way["public_transport"="station"](${b});
  way["station"="subway"](${b});
  way["public_transport"="platform"]["subway"="yes"](${b});
  node["railway"~"^(station|subway_entrance)$"](${b});
  way["landuse"="residential"]["residential"~"^(apartment|apartments)$"](${b});
);
out geom;`;
}

async function fetchOverpass(query) {
  let lastError = "";
  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "SafeHomeSimulator/1.0 cache builder",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      return res.json();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError || "Overpass failed");
}

function isStationElement(el) {
  const tags = el.tags ?? {};
  return Boolean(
    tags.building === "train_station" ||
      tags.railway === "station" ||
      tags.railway === "subway_entrance" ||
      tags.station === "subway" ||
      tags.subway === "yes" ||
      tags.public_transport === "station",
  );
}

function isApartmentComplexElement(el) {
  const tags = el.tags ?? {};
  return tags.landuse === "residential" &&
    ["apartment", "apartments"].includes(String(tags.residential ?? "").toLowerCase());
}

function isUndergroundSubwayElement(el) {
  const tags = el.tags ?? {};
  if (tags.railway !== "subway") return false;
  const layer = Number(tags.layer ?? "0");
  return !(tags.bridge === "yes" || tags.embankment === "yes" || tags.location === "overground" || layer > 0);
}

function circlePolygon(lat, lng, radiusM = 24) {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2;
    return {
      lat: lat + (Math.sin(angle) * radiusM) / 111111,
      lng: lng + (Math.cos(angle) * radiusM) / (111111 * Math.cos((lat * Math.PI) / 180)),
    };
  });
}

function parseOverpassRoads(elements = []) {
  const walkLines = [];
  const subwayLines = [];
  const stationPolygons = [];
  const apartmentPolygons = [];

  for (const el of elements) {
    if (isStationElement(el) && el.lat !== undefined && el.lon !== undefined) {
      stationPolygons.push(circlePolygon(el.lat, el.lon));
      continue;
    }
    if (!el.geometry) continue;

    if (isStationElement(el) && el.geometry.length > 2) {
      stationPolygons.push(el.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon })));
      continue;
    }
    if (isApartmentComplexElement(el) && el.geometry.length > 2) {
      apartmentPolygons.push(el.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon })));
      continue;
    }
    if (isUndergroundSubwayElement(el)) {
      for (let i = 0; i < el.geometry.length - 1; i += 1) {
        subwayLines.push(makeWalkLine(
          { lat: el.geometry[i].lat, lng: el.geometry[i].lon },
          { lat: el.geometry[i + 1].lat, lng: el.geometry[i + 1].lon },
          8,
          "subway",
        ));
      }
      continue;
    }
    const highway = el.tags?.highway;
    if (!highway) continue;
    const maxDistM = ROAD_SEGMENT_TOLERANCE_M;
    for (let i = 0; i < el.geometry.length - 1; i += 1) {
      walkLines.push(makeWalkLine(
        { lat: el.geometry[i].lat, lng: el.geometry[i].lon },
        { lat: el.geometry[i + 1].lat, lng: el.geometry[i + 1].lon },
        maxDistM,
        highway,
      ));
    }
  }

  return {
    walkLines: bridgeRoadGaps(walkLines),
    subwayLines,
    stationPolygons,
    walkPolygons: [...stationPolygons, ...apartmentPolygons],
    apartmentPolygons,
    blockPolygons: [],
    buildingCoverage: [],
  };
}

function lineKey(line) {
  return [
    line.p1.lat.toFixed(6),
    line.p1.lng.toFixed(6),
    line.p2.lat.toFixed(6),
    line.p2.lng.toFixed(6),
    Math.round(line.maxDistM),
    line.highway ?? "",
  ].join("|");
}

function mergeWalkLines(primary, supplement) {
  const seen = new Set(primary.map(lineKey));
  const out = [...primary];
  for (const line of supplement) {
    const key = lineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function mergePolygons(primary, supplement) {
  const seen = new Set(primary.map((poly) => `${poly[0]?.lat.toFixed(6)}|${poly[0]?.lng.toFixed(6)}|${poly.length}`));
  const out = [...primary];
  for (const poly of supplement) {
    if (poly.length < 3) continue;
    const key = `${poly[0].lat.toFixed(6)}|${poly[0].lng.toFixed(6)}|${poly.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(poly);
  }
  return out;
}


async function buildEntry(bbox) {
  console.log(`[map-cache] ${bbox.name} roads… (VWorld+OSM)`);
  const t0 = Date.now();
  const [vworldRoadFeatures, osmJson] = await Promise.all([
    fetchVworldFeatures(VWORLD_ROAD_LAYER, bbox, MAX_ROAD_PAGES).catch((err) => {
      console.warn(`[map-cache] VWorld roads failed (${bbox.name}):`, err.message);
      return [];
    }),
    fetchOverpass(buildRoadsQuery(bbox)).catch((err) => {
      console.warn(`[map-cache] OSM roads failed (${bbox.name}):`, err.message);
      return { elements: [] };
    }),
  ]);
  console.log(
    `[map-cache] ${bbox.name} roads raw: vworld=${vworldRoadFeatures.length.toLocaleString()} osm=${(osmJson.elements ?? []).length.toLocaleString()} (${Date.now() - t0}ms)`,
  );

  const vworldLines = featuresToWalkLines(vworldRoadFeatures, estimateVworldRoadHalfWidthM);
  const osmRoads = parseOverpassRoads(osmJson.elements ?? []);
  const roads = {
    walkLines: bridgeRoadGaps(mergeWalkLines(vworldLines, osmRoads.walkLines)),
    subwayLines: osmRoads.subwayLines,
    stationPolygons: osmRoads.stationPolygons,
    walkPolygons: mergePolygons(osmRoads.stationPolygons, osmRoads.apartmentPolygons),
    apartmentPolygons: osmRoads.apartmentPolygons,
    blockPolygons: [],
    buildingCoverage: [bbox],
  };

  console.log(`[map-cache] ${bbox.name} buildings… (VWorld)`);
  const t1 = Date.now();
  const buildingFeatures = await fetchVworldFeatures(
    VWORLD_BUILDING_LAYER,
    bbox,
    MAX_BUILDING_PAGES,
  ).catch((err) => {
    console.warn(`[map-cache] VWorld buildings failed (${bbox.name}):`, err.message);
    return [];
  });
  const blockPolygons = featuresToBlockPolygons(buildingFeatures);
  console.log(
    `[map-cache] ${bbox.name} buildings raw: ${buildingFeatures.length.toLocaleString()} → polys=${blockPolygons.length.toLocaleString()} (${Date.now() - t1}ms)`,
  );

  return {
    roadsEntry: { bbox, roads },
    buildingsEntry: { bbox, blockPolygons },
  };
}

function pickBatch(bboxes, progress, force) {
  const completed = new Set(progress.completed);
  const skipped = new Set(
    Object.entries(progress.failed ?? {})
      .filter(([, msg]) => String(msg).startsWith("SKIP:"))
      .map(([name]) => name),
  );
  const batch = [];
  let index = Math.max(0, Math.min(progress.nextIndex, bboxes.length));

  while (batch.length < BATCH_SIZE && index < bboxes.length) {
    const cell = bboxes[index];
    index += 1;
    if (!force && completed.has(cell.name)) continue;
    if (!force && skipped.has(cell.name)) continue;
    batch.push(cell);
  }

  if (batch.length < BATCH_SIZE) {
    for (const cell of bboxes) {
      if (batch.length >= BATCH_SIZE) break;
      if (!force && completed.has(cell.name)) continue;
      if (!force && skipped.has(cell.name)) continue;
      if (batch.some((b) => b.name === cell.name)) continue;
      batch.push(cell);
    }
  }

  if (!force) {
    const retryFirst = [];
    for (const [name, msg] of Object.entries(progress.failed ?? {})) {
      if (String(msg).startsWith("SKIP:")) continue;
      if (completed.has(name)) continue;
      const cell = bboxes.find((b) => b.name === name);
      if (!cell) continue;
      if (batch.some((b) => b.name === name)) continue;
      retryFirst.push(cell);
    }
    if (retryFirst.length > 0) {
      return { batch: [...retryFirst, ...batch].slice(0, BATCH_SIZE), nextIndex: index };
    }
  }

  return { batch, nextIndex: index };
}

async function persistCell(index, bbox, roadsEntry, buildingsEntry) {
  const roadsRel = `roads/${bbox.name}.json.gz`;
  const buildingsRel = `buildings/${bbox.name}.json.gz`;
  console.log(`[map-cache] ${bbox.name} gzip 저장 중…`);
  await writeRoadsShard(join(SHARD_DIR, roadsRel), roadsEntry);
  await writeBuildingsShard(join(SHARD_DIR, buildingsRel), buildingsEntry);
  upsertIndexCell(index, {
    name: bbox.name,
    south: bbox.south,
    west: bbox.west,
    north: bbox.north,
    east: bbox.east,
    roads: roadsRel,
    buildings: buildingsRel,
    compressed: true,
    roadCount: roadsEntry.roads.walkLines.length,
    buildingCount: buildingsEntry.blockPolygons.length,
    updatedAt: new Date().toISOString(),
  });
  saveIndex(index);
  return {
    roadCount: roadsEntry.roads.walkLines.length,
    buildingCount: buildingsEntry.blockPolygons.length,
  };
}

async function processCell(bbox, index, progress, depth = 0) {
  let lastError = null;

  for (let attempt = 1; attempt <= CELL_RETRIES + 1; attempt += 1) {
    try {
      if (attempt > 1) {
        console.warn(`[map-cache] ↻ 재시도 ${attempt - 1}/${CELL_RETRIES} — ${bbox.name}`);
        await sleep(Math.min(10_000, 1500 * attempt));
      }
      const { roadsEntry, buildingsEntry } = await buildEntry(bbox);
      const counts = await persistCell(index, bbox, roadsEntry, buildingsEntry);
      if (!progress.completed.includes(bbox.name)) progress.completed.push(bbox.name);
      delete progress.failed[bbox.name];
      console.log(
        `[map-cache] ✔ ${bbox.name}: roads=${counts.roadCount.toLocaleString()} buildings=${counts.buildingCount.toLocaleString()} (${progress.completed.length}/${progress.total}) [gz]`,
      );
      return { ok: true, skipped: false, split: false };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[map-cache] ✖ ${bbox.name} 시도 ${attempt}/${CELL_RETRIES + 1}: ${msg}`);

      if (isOversizedError(err) && depth < SPLIT_MAX_DEPTH) {
        console.warn(
          `[map-cache] ↕ 용량 초과 → ${bbox.name} 을 4분할 (depth ${depth + 1}/${SPLIT_MAX_DEPTH})`,
        );
        const parts = splitBbox(bbox);
        let allOk = true;
        for (const part of parts) {
          const result = await processCell(part, index, progress, depth + 1);
          if (!result.ok) allOk = false;
        }
        if (allOk) {
          if (!progress.completed.includes(bbox.name)) progress.completed.push(bbox.name);
          delete progress.failed[bbox.name];
          console.log(`[map-cache] ✔ ${bbox.name}: 4분할 하위 칸 모두 완료로 표시`);
          return { ok: true, skipped: false, split: true };
        }
        progress.failed[bbox.name] = `SPLIT_PARTIAL: ${msg}`;
        saveProgress(progress);
        return { ok: false, skipped: false, split: true };
      }
    }
  }

  const finalMsg = lastError instanceof Error ? lastError.message : String(lastError);
  progress.failed[bbox.name] = `SKIP: ${finalMsg}`;
  console.warn(`[map-cache] ⏭ SKIP ${bbox.name} — 재시도 소진: ${finalMsg}`);
  saveProgress(progress);
  return { ok: false, skipped: true, split: false };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const initOnly = args.has("--init") || process.env.MAP_CACHE_INIT === "1";
  const force = args.has("--force") || process.env.MAP_CACHE_FORCE === "1";

  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(ROADS_SHARD_DIR, { recursive: true });
  mkdirSync(BUILDINGS_SHARD_DIR, { recursive: true });

  const bboxes = ensureNationwideBboxes(initOnly || args.has("--init"));
  if (initOnly) {
    const progress = loadProgress(bboxes.length);
    progress.total = bboxes.length;
    if (args.has("--init") || process.env.MAP_CACHE_INIT === "1") {
      progress.completed = [];
      progress.failed = {};
      progress.nextIndex = 0;
    }
    saveProgress(progress);
    console.log(`[map-cache] init 완료. 다음: npm run build:map-cache  (하루 ${BATCH_SIZE}칸씩)`);
    console.log(`[map-cache] 예상 일수(대략): ${Math.ceil(bboxes.length / BATCH_SIZE)}일`);
    return;
  }

  const progress = loadProgress(bboxes.length);
  progress.total = bboxes.length;
  const completedSet = new Set(progress.completed);
  const skippedCount = Object.values(progress.failed ?? {}).filter((m) =>
    String(m).startsWith("SKIP:"),
  ).length;
  const remaining = bboxes.filter((b) => !completedSet.has(b.name)).length - skippedCount;

  if (remaining <= 0 && !force) {
    console.log(`[map-cache] 전국 ${bboxes.length}칸 모두 완료(또는 SKIP)되었습니다.`);
    console.log(`완료=${progress.completed.length}, SKIP=${skippedCount}`);
    console.log("재생성: MAP_CACHE_FORCE=1 npm run build:map-cache");
    return;
  }

  const { batch, nextIndex } = pickBatch(bboxes, progress, force);
  console.log(
    `[map-cache] 배치 시작: ${batch.length}칸 / 남은 약 ${Math.max(0, remaining)}칸 / 전체 ${bboxes.length}칸 (BATCH=${BATCH_SIZE}, RETRIES=${CELL_RETRIES})`,
  );
  if (batch.length === 0) {
    console.log("[map-cache] 처리할 칸 없음");
    return;
  }

  const index = loadIndex();
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let split = 0;

  for (let i = 0; i < batch.length; i += 1) {
    const bbox = batch[i];
    if (progress.failed[bbox.name] && !String(progress.failed[bbox.name]).startsWith("SKIP:")) {
      console.log(`[map-cache] 이전 실패 칸 재시도: ${bbox.name} (${progress.failed[bbox.name]})`);
    }

    const result = await processCell(bbox, index, progress, 0);
    if (result.ok) ok += 1;
    else if (result.skipped) skipped += 1;
    else fail += 1;
    if (result.split) split += 1;

    progress.nextIndex = nextIndex;
    saveProgress(progress);

    if (i < batch.length - 1 && CELL_GAP_MS > 0) {
      await sleep(CELL_GAP_MS);
    }
  }

  const left =
    bboxes.length -
    progress.completed.length -
    Object.values(progress.failed ?? {}).filter((m) => String(m).startsWith("SKIP:")).length;
  console.log(
    `[map-cache] 배치 종료: 성공 ${ok}, 실패 ${fail}, SKIP ${skipped}, 분할 ${split}, 완료 ${progress.completed.length}/${bboxes.length}, 남음 ${Math.max(0, left)}`,
  );
  if (left > 0) {
    console.log("[map-cache] 다음에 이어서: npm run build:map-cache");
  } else {
    console.log("[map-cache] 전국 캐시 완료");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
