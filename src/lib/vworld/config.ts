/** VWorld Open API 인증키 */
export function resolveVworldApiKey(): string {
  return process.env.VWORLD_API_KEY?.trim() ?? "";
}

/**
 * VWorld 개발자센터 → 나의 오픈API → 서비스URL 과 **완전히 동일**한 값.
 * WMS·2D데이터 API는 domain 불일치 시 "인증키 정보가 올바르지 않습니다" 오류.
 * (지오코더·검색 API는 domain 없이도 동작하는 경우가 많음)
 */
export function resolveVworldDomain(): string {
  const fromEnv = process.env.VWORLD_DOMAIN?.trim();
  if (fromEnv) return fromEnv;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

export function isVworldConfigured(): boolean {
  return Boolean(resolveVworldApiKey());
}
