declare module "leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs" {
  import type { GridLayer, GridLayerOptions } from "leaflet";

  export interface GoogleMutantOptions extends GridLayerOptions {
    type?: "roadmap" | "satellite" | "terrain" | "hybrid";
  }

  export default class GoogleMutant extends GridLayer {
    constructor(options?: GoogleMutantOptions);
  }
}
