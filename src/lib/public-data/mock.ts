import type { Bbox, NormalizedFacility } from "./types";

export function generateMockFacilities(bbox: Bbox): NormalizedFacility[] {
  const { south, north, west, east } = bbox;
  const facilities: NormalizedFacility[] = [];
  const configs: { type: NormalizedFacility["type"]; count: number }[] = [
    { type: "light", count: 30 },
    { type: "bell", count: 10 },
  ];

  let idCounter = 0;
  for (const config of configs) {
    for (let i = 0; i < config.count; i++) {
      const lat = south + Math.random() * (north - south);
      const lng = west + Math.random() * (east - west);
      idCounter += 1;
      facilities.push({
        id: `mock-${config.type}-${idCounter}`,
        type: config.type,
        lat,
        lng,
        name: `Mock ${config.type} ${idCounter}`,
      });
    }
  }

  return facilities;
}