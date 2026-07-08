import type L from "leaflet";
import type { LatLng } from "./types";

export interface DestinationIndicatorState {
  visible: boolean;
  x: number;
  y: number;
  angleDeg: number;
}

const EDGE_MARGIN = 56;
const ON_SCREEN_MARGIN = 48;

export function computeDestinationIndicator(
  map: L.Map,
  player: LatLng,
  destination: LatLng,
): DestinationIndicatorState {
  const destPoint = map.latLngToContainerPoint([destination.lat, destination.lng]);
  const playerPoint = map.latLngToContainerPoint([player.lat, player.lng]);
  const size = map.getSize();

  const onScreen =
    destPoint.x >= ON_SCREEN_MARGIN &&
    destPoint.x <= size.x - ON_SCREEN_MARGIN &&
    destPoint.y >= ON_SCREEN_MARGIN &&
    destPoint.y <= size.y - ON_SCREEN_MARGIN;

  if (onScreen) {
    return { visible: false, x: 0, y: 0, angleDeg: 0 };
  }

  const dx = destPoint.x - playerPoint.x;
  const dy = destPoint.y - playerPoint.y;
  // CSS의 ▲는 위쪽이 0도이므로, atan2의 오른쪽 0도 기준을 90도 보정한다.
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

  const halfW = size.x / 2 - EDGE_MARGIN;
  const halfH = size.y / 2 - EDGE_MARGIN;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let edgeX: number;
  let edgeY: number;

  if (absDx * halfH > absDy * halfW) {
    edgeX = dx > 0 ? size.x - EDGE_MARGIN : EDGE_MARGIN;
    edgeY = playerPoint.y + (dy / dx) * (edgeX - playerPoint.x);
  } else {
    edgeY = dy > 0 ? size.y - EDGE_MARGIN : EDGE_MARGIN;
    edgeX = playerPoint.x + (dx / dy) * (edgeY - playerPoint.y);
  }

  edgeX = Math.max(EDGE_MARGIN, Math.min(size.x - EDGE_MARGIN, edgeX));
  edgeY = Math.max(EDGE_MARGIN, Math.min(size.y - EDGE_MARGIN, edgeY));

  return { visible: true, x: edgeX, y: edgeY, angleDeg };
}
