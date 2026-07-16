"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type L from "leaflet";
import { VWORLD_MAP_ZOOM } from "@/lib/game/constants";

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

function ClampZoom({ maxZoom }: { maxZoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (map.getZoom() > maxZoom) {
      map.setZoom(maxZoom);
    }
  }, [map, maxZoom]);
  return null;
}

export function MapView({
  center,
  zoom = 15,
  onMapReady,
}: MapViewProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      maxZoom={VWORLD_MAP_ZOOM}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      preferCanvas
      attributionControl
      className="game-map"
      style={{ width: "100vw", height: "100vh" }}
    >
      <ClampZoom maxZoom={VWORLD_MAP_ZOOM} />
      <TileLayer
        attribution='&copy; <a href="https://www.vworld.kr/">VWorld</a> / 국토교통부'
        url="/api/map-tiles/{z}/{x}/{y}.png"
        maxZoom={VWORLD_MAP_ZOOM}
      />
      <MapReadyBridge onMapReady={onMapReady} />
    </MapContainer>
  );
}
