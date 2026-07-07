"use client";

import type L from "leaflet";
import { useEffect } from "react";
import { AttributionControl, useMap } from "react-leaflet";
import { GAME_MAP_ZOOM } from "@/lib/game/constants";
import { createGoogleMutantLayer } from "@/lib/google-maps/google-mutant-layer";
import { loadGoogleMaps } from "@/lib/google-maps/loader";

interface GoogleMutantLayerProps {
  apiKey: string;
  onError?: () => void;
}

export function GoogleMutantLayer({ apiKey, onError }: GoogleMutantLayerProps) {
  const map = useMap();

  useEffect(() => {
    let layer: L.Layer | null = null;
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled) return;

        const mutantLayer = createGoogleMutantLayer({
          type: "roadmap",
          maxZoom: GAME_MAP_ZOOM,
        });
        layer = mutantLayer;
        mutantLayer.addTo(map);
        map.invalidateSize();
      })
      .catch((err) => {
        console.warn("[map] Google Maps 로드 실패:", err);
        onError?.();
      });

    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [apiKey, map, onError]);

  return (
    <AttributionControl
      position="bottomright"
      prefix='&copy; <a href="https://www.google.com/maps">Google</a>'
    />
  );
}
