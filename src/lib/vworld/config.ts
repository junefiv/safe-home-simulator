/** VWorld Open API 인증키 */
export function resolveVworldApiKey(): string {
  return process.env.VWORLD_API_KEY?.trim() ?? "";
}

/**
 * VWorld 개발자센터 → 나의 오픈API → 서비스URL 과 동일한 값
 * (http://localhost:3000 이 아니라 포털에 적은 문자열 그대로, 예: test중)
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
