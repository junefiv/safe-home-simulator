import type { GridLayerOptions } from "leaflet";
import GoogleMutant from "leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs";

export type GoogleMutantOptions = GridLayerOptions & {
  type?: "roadmap" | "satellite" | "terrain" | "hybrid";
};

/** ESM 번들에서 L.gridLayer.googleMutant 팩토리가 깨지므로 클래스를 직접 생성 */
export function createGoogleMutantLayer(options: GoogleMutantOptions) {
  return new GoogleMutant(options);
}
