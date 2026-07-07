import type L from "leaflet";
import type { BlockPolygon } from "./blockPolygon";
import { cellStorageKey } from "./blockPolygon";
import type { Bbox } from "./types";

/** 화면 뷰 1칸 = 지도 getBounds() 크기, 3×3(중앙+8방향) 선로딩 */
export interface ViewportGrid {
  originSouth: number;
  originWest: number;
  latSpan: number;
  lngSpan: number;
}

export interface GridCell {
  row: number;
  col: number;
}

export const SURROUND_OFFSETS: GridCell[] = [
  { row: 0, col: 0 },
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

export function createViewportGrid(map: L.Map): ViewportGrid {
  const b = map.getBounds();
  return {
    originSouth: b.getSouth(),
    originWest: b.getWest(),
    latSpan: b.getNorth() - b.getSouth(),
    lngSpan: b.getEast() - b.getWest(),
  };
}

export function getPlayerGridCell(lat: number, lng: number, grid: ViewportGrid): GridCell {
  return {
    row: Math.floor((lat - grid.originSouth) / grid.latSpan),
    col: Math.floor((lng - grid.originWest) / grid.lngSpan),
  };
}

export function gridCellToBbox(cell: GridCell, grid: ViewportGrid): Bbox {
  return {
    south: grid.originSouth + cell.row * grid.latSpan,
    north: grid.originSouth + (cell.row + 1) * grid.latSpan,
    west: grid.originWest + cell.col * grid.lngSpan,
    east: grid.originWest + (cell.col + 1) * grid.lngSpan,
  };
}

export function padBbox(bbox: Bbox, ratio = 0.08): Bbox {
  const latPad = (bbox.north - bbox.south) * ratio;
  const lngPad = (bbox.east - bbox.west) * ratio;
  return {
    south: bbox.south - latPad,
    north: bbox.north + latPad,
    west: bbox.west - lngPad,
    east: bbox.east + lngPad,
  };
}

export function getBuildingFetchBbox(
  cell: GridCell,
  grid: ViewportGrid,
  lookaheadRatio = 1,
): Bbox {
  return padBbox(gridCellToBbox(cell, grid), lookaheadRatio);
}

/** 플레이어 중심 3×3 셀 전체를 한 번에 요청하는 bbox */
export function getSurroundBbox(center: GridCell, grid: ViewportGrid): Bbox {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const cell of getSurroundingCells(center)) {
    const b = gridCellToBbox(cell, grid);
    south = Math.min(south, b.south);
    north = Math.max(north, b.north);
    west = Math.min(west, b.west);
    east = Math.max(east, b.east);
  }

  return padBbox({ south, north, west, east }, 0.05);
}

export function isSameCell(a: GridCell | null, b: GridCell): boolean {
  return a !== null && a.row === b.row && a.col === b.col;
}

/** 중앙 셀 + 상하좌우·대각 8칸 (중앙이 첫 번째) */
export function getSurroundingCells(center: GridCell): GridCell[] {
  return SURROUND_OFFSETS.map((offset) => ({
    row: center.row + offset.row,
    col: center.col + offset.col,
  }));
}

export function dedupeBlockPolygons(polygons: BlockPolygon[]): BlockPolygon[] {
  const seen = new Set<string>();
  const out: BlockPolygon[] = [];
  for (const block of polygons) {
    const key = `${block.minLat.toFixed(5)}|${block.minLng.toFixed(5)}|${block.points.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }
  return out;
}

export function collectSurroundingPolygons(
  center: GridCell,
  store: Map<string, BlockPolygon[]>,
): BlockPolygon[] {
  const merged: BlockPolygon[] = [];
  for (const cell of getSurroundingCells(center)) {
    const polys = store.get(cellStorageKey(cell.row, cell.col));
    if (polys) merged.push(...polys);
  }
  return dedupeBlockPolygons(merged);
}

export function pruneTileStore(
  store: Map<string, BlockPolygon[]>,
  center: GridCell,
  keepRadius = 2,
): void {
  for (const key of store.keys()) {
    const [row, col] = key.split(":").map(Number);
    if (
      Math.abs(row - center.row) > keepRadius ||
      Math.abs(col - center.col) > keepRadius
    ) {
      store.delete(key);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
