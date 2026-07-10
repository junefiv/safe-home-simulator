const OVERPASS_SERVERS = [
  "https://overpass.openstreetmap.kr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const USER_AGENT = "SafeHomeSimulator/1.0 (educational project)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function buildSubwayOverpassQuery(bbox: string): string {
  return `[out:json][timeout:12];
(
  way["railway"="subway"](${bbox});
  way["building"="train_station"](${bbox});
  way["railway"="station"](${bbox});
  way["public_transport"="station"](${bbox});
  way["station"="subway"](${bbox});
  node["railway"~"^(station|subway_entrance)$"](${bbox});
);
out geom;`;
}

export function buildRoadsOverpassQuery(bbox: string): string {
  return `[out:json][timeout:8];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|service|residential|unclassified|tertiary|tertiary_link|road)$"](${bbox});
  way["railway"="subway"](${bbox});
  way["building"="train_station"](${bbox});
  way["railway"="station"](${bbox});
  way["public_transport"="station"](${bbox});
  way["station"="subway"](${bbox});
  way["public_transport"="platform"]["subway"="yes"](${bbox});
  node["railway"~"^(station|subway_entrance)$"](${bbox});
  way["landuse"="residential"]["residential"~"^(apartment|apartments)$"](${bbox});
);
out geom;`;
}

export function buildBuildingsOverpassQuery(bbox: string): string {
  return `[out:json][timeout:40];
(
  way["building"](${bbox});
  relation["building"](${bbox});
);
out geom;`;
}

export async function fetchOverpassJson(
  query: string,
  timeoutMs = 28_000,
): Promise<{ elements?: unknown[] }> {
  let lastError = "Overpass API is unavailable";

  for (const server of OVERPASS_SERVERS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(server, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (isRetryableStatus(res.status)) {
          lastError = `Overpass ${res.status} (${server})`;
          await sleep(800 * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          lastError = `Overpass HTTP ${res.status}`;
          break;
        }

        return (await res.json()) as { elements?: unknown[] };
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Overpass fetch failed";
        await sleep(600 * (attempt + 1));
      }
    }
  }

  throw new Error(lastError);
}

export async function fetchOverpassJsonFast(
  query: string,
  timeoutMs = 8_000,
): Promise<{ elements?: unknown[] }> {
  let lastError = "Overpass fast fetch failed";

  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        lastError = `Overpass HTTP ${res.status} (${server})`;
        continue;
      }

      return (await res.json()) as { elements?: unknown[] };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Overpass fast fetch failed";
    }
  }

  throw new Error(lastError);
}
