import proj4 from "proj4";
import type { LatLng } from "@/lib/game/types";

proj4.defs(
  "EPSG:5174",
  "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=600000 +ellps=bessel +units=m +no_defs",
);

export function epsg5174ToWgs84(x: number, y: number): LatLng {
  const [lng, lat] = proj4("EPSG:5174", "WGS84", [x, y]) as [number, number];
  return { lat, lng };
}

export function epsg3857ToWgs84(x: number, y: number): LatLng {
  const [lng, lat] = proj4("EPSG:3857", "WGS84", [x, y]) as [number, number];
  return { lat, lng };
}

export function bboxWgs84To3857(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const toX = (lng: number) => (lng * 20037508.34) / 180;
  const toY = (lat: number) =>
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.34 / 180);
  return `${toX(bbox.west)},${toY(bbox.south)},${toX(bbox.east)},${toY(bbox.north)}`;
}

export function parseCoordinate(
  record: Record<string, unknown>,
): LatLng | null {
  const latKeys = ["lat", "latitude", "LAT", "위도", "WGS84_LAT", "y"];
  const lngKeys = ["lng", "lon", "longitude", "LNG", "경도", "WGS84_LON", "x"];

  let lat: number | undefined;
  let lng: number | undefined;

  for (const key of latKeys) {
    const v = record[key];
    if (v !== undefined && v !== null && v !== "") {
      lat = Number(v);
      break;
    }
  }
  for (const key of lngKeys) {
    const v = record[key];
    if (v !== undefined && v !== null && v !== "") {
      lng = Number(v);
      break;
    }
  }

  if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  const tmX = Number(record.tmX ?? record.TM_X ?? record.X ?? record.x_coord);
  const tmY = Number(record.tmY ?? record.TM_Y ?? record.Y ?? record.y_coord);
  if (!Number.isNaN(tmX) && !Number.isNaN(tmY) && tmX > 1000 && tmY > 1000) {
    return epsg5174ToWgs84(tmX, tmY);
  }

  return null;
}