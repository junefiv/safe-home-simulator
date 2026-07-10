import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, ".cache");
const BBOX_CONFIG_PATH = join(CACHE_DIR, "map-cache-bboxes.json");
const ROADS_OUT = join(CACHE_DIR, "roads-cache.json");
const BUILDINGS_OUT = join(CACHE_DIR, "buildings-cache.json");

const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";
const VWORLD_ROAD_LAYER = "LT_L_SPRD";
const VWORLD_BUILDING_LAYER = "LT_C_BLDGINFO";
const OVERPASS_SERVERS = [
  "https://overpass.openstreetmap.kr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const ROAD_SEGMENT_TOLERANCE_M = 14;
const ROAD_JUNCTION_SLACK_M = 8;
const ROAD_BRIDGE_MAX_M = 18;
const PAGE_SIZE = 1000;
const MAX_ROAD_PAGES = 30;
const MAX_BUILDING_PAGES = 30;

function usage() {
  console.error(`지도 캐시 bbox 설정이 필요합니다.

1) .cache/map-cache-bboxes.json 생성:
[
  { "name": "회기역", "south": 37.589, "west": 127.055, "north": 37.604, "east": 127.075 }
]

2) 실행:
npm run build:map-cache

또는 MAP_CACHE_BBOXES='[...]' 환경변수로도 전달할 수 있습니다.`);
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
  console.log(`[map-cache] ${bbox.name} roads...`);
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

  console.log(`[map-cache] ${bbox.name} buildings...`);
  const buildingFeatures = await fetchVworldFeatures(VWORLD_BUILDING_LAYER, bbox, MAX_BUILDING_PAGES).catch((err) => {
    console.warn(`[map-cache] VWorld buildings failed (${bbox.name}):`, err.message);
    return [];
  });
  const blockPolygons = featuresToBlockPolygons(buildingFeatures);

  return {
    roadsEntry: { bbox, roads },
    buildingsEntry: { bbox, blockPolygons },
  };
}

mkdirSync(CACHE_DIR, { recursive: true });
const bboxes = parseBboxes();
const roadsEntries = [];
const buildingsEntries = [];

for (const bbox of bboxes) {
  const { roadsEntry, buildingsEntry } = await buildEntry(bbox);
  roadsEntries.push(roadsEntry);
  buildingsEntries.push(buildingsEntry);
  console.log(
    `[map-cache] ${bbox.name}: roads=${roadsEntry.roads.walkLines.length.toLocaleString()} buildings=${buildingsEntry.blockPolygons.length.toLocaleString()}`,
  );
}

writeFileSync(
  ROADS_OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), entries: roadsEntries }, null, 2),
);
writeFileSync(
  BUILDINGS_OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), entries: buildingsEntries }, null, 2),
);

console.log(`[map-cache] wrote ${ROADS_OUT}`);
console.log(`[map-cache] wrote ${BUILDINGS_OUT}`);
