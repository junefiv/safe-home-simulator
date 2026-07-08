import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedFacility } from "@/lib/game/types";

const CSV_PATH = join(process.cwd(), ".cache", "안전비상벨위치정보.csv");
let cachePromise: Promise<NormalizedFacility[]> | null = null;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields;
}

async function loadEmergencyBells(): Promise<NormalizedFacility[]> {
  const bytes = await readFile(CSV_PATH);
  const text = new TextDecoder("euc-kr").decode(bytes);
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0] ?? "");
  const index = new Map(headers.map((header, i) => [header.trim(), i]));
  const at = (row: string[], name: string) => row[index.get(name) ?? -1] ?? "";
  const facilities: NormalizedFacility[] = [];
  const seenCoordinates = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const row = parseCsvLine(lines[i]);
    const lat = Number(at(row, "WGS84위도"));
    const lng = Number(at(row, "WGS84경도"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const coordinateKey = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (seenCoordinates.has(coordinateKey)) continue;
    seenCoordinates.add(coordinateKey);
    facilities.push({
      id: `bell-${at(row, "관리번호") || i}`,
      type: "bell",
      lat,
      lng,
      name: at(row, "설치위치") || at(row, "안전비상벨관리번호") || "안전비상벨",
      address: at(row, "소재지도로명주소") || at(row, "소재지지번주소"),
    });
  }

  return facilities;
}

export function getEmergencyBellFacilities(): Promise<NormalizedFacility[]> {
  if (!cachePromise) cachePromise = loadEmergencyBells().catch(() => []);
  return cachePromise;
}
