"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type L from "leaflet";

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  onMapReady: (map: L.Map) => void;
}

function MapReadyBridge({ onMapReady }: { onMapReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);
  return null;
}

export function MapView({ center, zoom = 15, onMapReady }: MapViewProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomControl={false}
      className="game-map"
      style={{ width: "100vw", height: "100vh" }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <MapReadyBridge onMapReady={onMapReady} />
    </MapContainer>
  );
}