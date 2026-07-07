"use client";

import type L from "leaflet";
import { useEffect, useState } from "react";
import {
  computeDestinationIndicator,
  type DestinationIndicatorState,
} from "@/lib/game/destinationIndicator";
import type { LatLng } from "@/lib/game/types";

interface DestinationIndicatorProps {
  map: L.Map | null;
  destination: LatLng | null;
  getPlayerPosition: () => LatLng | null;
  distToHome: number | null;
  active: boolean;
}

export function DestinationIndicator({
  map,
  destination,
  getPlayerPosition,
  distToHome,
  active,
}: DestinationIndicatorProps) {
  const [indicator, setIndicator] = useState<DestinationIndicatorState | null>(null);

  useEffect(() => {
    if (!active || !map || !destination) {
      return;
    }

    let raf = 0;
    let lastUpdate = 0;

    const update = (now: number) => {
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      const player = getPlayerPosition();
      if (!player) return;
      setIndicator(computeDestinationIndicator(map, player, destination));
    };

    const tick = (now: number) => {
      update(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMapMove = () => update(performance.now());
    map.on("move", onMapMove);
    map.on("zoom", onMapMove);
    map.on("resize", onMapMove);

    return () => {
      cancelAnimationFrame(raf);
      map.off("move", onMapMove);
      map.off("zoom", onMapMove);
      map.off("resize", onMapMove);
    };
  }, [active, destination, getPlayerPosition, map]);

  if (!active || !map || !destination || !indicator?.visible) return null;

  return (
    <div
      className="destination-indicator"
      style={{ left: indicator.x, top: indicator.y }}
      aria-label="도착지 방향"
    >
      <div
        className="destination-indicator-arrow"
        style={{ transform: `rotate(${indicator.angleDeg}deg)` }}
      >
        <span className="destination-indicator-chevron">▲</span>
        <span className="destination-indicator-icon">🏠</span>
      </div>
      <div className="destination-indicator-label">
        집
        {distToHome !== null && (
          <span className="destination-indicator-distance">{Math.floor(distToHome)}m</span>
        )}
      </div>
    </div>
  );
}
