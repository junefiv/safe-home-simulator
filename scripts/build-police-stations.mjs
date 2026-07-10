/**
 * 경찰청 파출소 API + Vworld 지오코딩 → .cache/police-stations.json 생성
 *
 *   npm run build:police-stations
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../.cache");
const OUT_PATH = join(CACHE_DIR, "police-stations.json");
const ENDPOINT =
  "https://api.odcloud.kr/api/15077036/v1/uddi:6b371c66-09a5-4efd-8445-bfd53672542e";
const VWORLD_URL = "https://api.vworld.kr/req/address";
const PER_PAGE = 100;

const serviceKeyRaw =
  process.env.ODCLOUD_SERVICE_KEY?.trim() ||
  process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const serviceKey = serviceKeyRaw?.includes("%")
  ? decodeURIComponent(serviceKeyRaw)
  : serviceKeyRaw;
const vworldKey = process.env.VWORLD_API_KEY?.trim();

if (!serviceKey) {
  console.error("ODCLOUD_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY가 필요합니다.");
  process.exit(1);
}
if (!vworldKey) {
  console.error("VWORLD_API_KEY가 필요합니다. https://www.vworld.kr 에서 발급");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanAddress(address) {
  return address
    .trim()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^서울시\b/, "서울특별시");
}

async function fetchAllRecords() {
  const records = [];
  let page = 1;
  let total = Infinity;

  while (records.length < total) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perPage", String(PER_PAGE));
    url.searchParams.set("serviceKey", serviceKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Police API ${res.status}`);
    const json = await res.json();
    total = json.totalCount ?? records.length;
    const data = json.data ?? [];
    if (data.length === 0) break;
    records.push(...data);
    console.log(`API page ${page}: ${records.length}/${total}`);
    page += 1;
  }

  return records;
}

async function geocodeVworld(address, type) {
  const url = new URL(VWORLD_URL);
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getCoord");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("address", address);
  url.searchParams.set("type", type);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", vworldKey);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      if (json.response?.status !== "OK") return null;
      const point = json.response?.result?.point;
      if (!point) return null;
      return { lat: parseFloat(point.y), lng: parseFloat(point.x) };
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

async function geocode(address) {
  const cleaned = cleanAddress(address);
  const road = await geocodeVworld(cleaned, "road");
  if (road) return road;
  return geocodeVworld(cleaned, "parcel");
}

async function main() {
  console.log("경찰청 파출소 목록 조회 중...");
  mkdirSync(CACHE_DIR, { recursive: true });
  const records = await fetchAllRecords();
  const facilities = [];
  const cache = new Map();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const address = record.주소?.trim();
    if (!address) continue;

    let coord = cache.get(address);
    if (!coord) {
      coord = await geocode(address);
      if (coord) cache.set(address, coord);
    }
    if (!coord) {
      console.warn(`지오코딩 실패 (${i + 1}/${records.length}): ${address}`);
      continue;
    }

    const branch = record.관서명?.trim() ?? "관서";
    const kind = record.구분?.trim() ?? "";
    facilities.push({
      id: `police-${record.연번 ?? i + 1}`,
      type: "police",
      lat: coord.lat,
      lng: coord.lng,
      name: kind ? `${branch} ${kind}` : branch,
      address,
    });

    if ((i + 1) % 50 === 0) {
      console.log(`지오코딩 진행: ${i + 1}/${records.length} (성공 ${facilities.length})`);
      writeFileSync(OUT_PATH, JSON.stringify(facilities, null, 2), "utf8");
    }
    await sleep(120);
  }

  writeFileSync(OUT_PATH, JSON.stringify(facilities, null, 2), "utf8");
  console.log(`완료: ${facilities.length}개 저장 → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
