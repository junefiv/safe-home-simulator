/** 생활안전지도(safemap.go.kr) serviceKey — searchParams용 디코딩 키 반환 */
export function resolveSafemapServiceKey(): string {
  const raw =
    process.env.SAFEMAP_SERVICE_KEY?.trim() ||
    process.env.DATA_GO_KR_SERVICE_KEY?.trim() ||
    "";

  if (!raw) return "";

  if (raw.includes("%")) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}
