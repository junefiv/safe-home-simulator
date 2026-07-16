/** 한국 주소 파싱용 필드 구조 */
export interface KoreanAddressParts {
  city?: string;
  borough?: string;
  road?: string;
  house_number?: string;
  quarter?: string;
  suburb?: string;
  building?: string;
  highway?: string;
}

const SIDO_SHORT_TO_FULL: [string, string][] = [
  ["서울", "서울특별시"],
  ["부산", "부산광역시"],
  ["대구", "대구광역시"],
  ["인천", "인천광역시"],
  ["광주", "광주광역시"],
  ["대전", "대전광역시"],
  ["울산", "울산광역시"],
  ["세종", "세종특별자치시"],
  ["경기", "경기도"],
  ["강원", "강원특별자치도"],
  ["충북", "충청북도"],
  ["충남", "충청남도"],
  ["전북", "전북특별자치도"],
  ["전남", "전라남도"],
  ["경북", "경상북도"],
  ["경남", "경상남도"],
  ["제주", "제주특별자치도"],
];

/** 카카오 등에서 "서울 동대문구 …" 형태를 "서울특별시 동대문구 …"로 확장 */
export function expandSidoPrefix(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;

  for (const [short, full] of SIDO_SHORT_TO_FULL) {
    if (trimmed.startsWith(`${full} `)) return trimmed;
    if (trimmed.startsWith(`${short} `)) {
      return `${full}${trimmed.slice(short.length)}`;
    }
  }
  return trimmed;
}

export function formatRoadAddressFromParts(parts: KoreanAddressParts): string | undefined {
  if (!parts.road) return undefined;

  const segments: string[] = [];
  if (parts.city) segments.push(parts.city);
  if (parts.borough) segments.push(parts.borough);
  segments.push(parts.road);
  if (parts.house_number) segments.push(parts.house_number);

  return segments.length >= 3 ? segments.join(" ") : undefined;
}

export function formatJibunAddressFromParts(parts: KoreanAddressParts): string | undefined {
  const dong = parts.quarter ?? parts.suburb;
  if (!dong) return undefined;

  const segments: string[] = [];
  if (parts.city) segments.push(parts.city);
  if (parts.borough) segments.push(parts.borough);
  segments.push(dong);
  // 도로명이 없을 때만 번지를 지번으로 취급
  if (!parts.road && parts.house_number) segments.push(parts.house_number);

  return segments.length >= 2 ? segments.join(" ") : undefined;
}

export function pickPlaceName(
  name: string | undefined,
  parts: KoreanAddressParts,
): string | undefined {
  if (name?.trim()) return name.trim();
  if (parts.building?.trim()) return parts.building.trim();
  if (parts.highway?.trim()) return parts.highway.trim();
  return undefined;
}

export function primaryLabelForGeocode(item: {
  name?: string;
  roadAddress?: string;
  jibunAddress?: string;
}): string {
  return item.name ?? item.roadAddress ?? item.jibunAddress ?? "";
}
