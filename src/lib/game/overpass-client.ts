const OVERPASS_SERVERS = [
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

export function buildRoadsOverpassQuery(bbox: string): string {
  return `[out:json][timeout:25];
(
  way["highway"](${bbox});
  way["building"="train_station"](${bbox});
  way["railway"="station"](${bbox});
  way["public_transport"="station"](${bbox});
);
out geom;`;
}

export async function fetchOverpassJson(query: string): Promise<{ elements?: unknown[] }> {
  let lastError = "Overpass API를 사용할 수 없습니다";

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
          signal: AbortSignal.timeout(28_000),
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
