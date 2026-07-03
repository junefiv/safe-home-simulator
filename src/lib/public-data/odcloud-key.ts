/** odcloud / 공공데이터포털 serviceKey — searchParams용 디코딩 키 반환 */
export function resolveOdcloudServiceKey(): string {
  const raw =
    process.env.ODCLOUD_SERVICE_KEY?.trim() ||
    process.env.DATA_GO_KR_SERVICE_KEY?.trim() ||
    "";

  if (!raw) return "";

  // 포털 Encoding 키(%2F 등)는 decode 후 searchParams.set에 넣어야 함
  if (raw.includes("%")) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}
