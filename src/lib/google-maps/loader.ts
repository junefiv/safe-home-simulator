import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google> | null = null;

export function resolveGoogleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function isGoogleMapsConfigured(): boolean {
  return Boolean(resolveGoogleMapsApiKey());
}

/** Maps JavaScript API — Embed/Static API는 게임 오버레이에 부적합 */
export function loadGoogleMaps(apiKeyOverride?: string): Promise<typeof google> {
  const apiKey = (apiKeyOverride ?? resolveGoogleMapsApiKey()).trim();
  if (!apiKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY가 없습니다"));
  }

  if (!loaderPromise) {
    setOptions({
      key: apiKey,
      v: "weekly",
      language: "ko",
      region: "KR",
    });
    loaderPromise = importLibrary("maps").then(() => {
      if (typeof google === "undefined") {
        throw new Error("Google Maps API 로드 실패");
      }
      return google;
    });
  }

  return loaderPromise;
}
