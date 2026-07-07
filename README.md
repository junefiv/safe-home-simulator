# 안심 귀가 시뮬레이터

실제 OpenStreetMap 지도와 도로(Overpass) 데이터, 공공데이터포털 시설물 API를 활용한 귀가 생존 게임입니다.

## 로컬 실행

```powershell
cd C:\safe-home-simulator
copy .env.example .env.local
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다.

## 환경 변수

| 변수 | 설명 |
|------|------|
| `ODCLOUD_SERVICE_KEY` | 공공데이터포털 odcloud 인증키 (**경찰청 파출소 API**, URL 인코딩 키 권장) |
| `DATA_GO_KR_SERVICE_KEY` | `ODCLOUD_SERVICE_KEY` 미설정 시 대체 키 |
| `VWORLD_API_KEY` | **브이월드** — 주소검색·지오코딩·건축물(2D데이터)·배경지도(WMS) |
| `VWORLD_DOMAIN` | VWorld에 등록한 도메인 (`http://localhost:3000` 등). 2D데이터·WMS 미등록 시 건물/지도 API 실패 |
| `BELL_API_URL` | 안심벨/비상벨 OpenAPI 엔드포인트 |
| `LIGHT_API_URL` | 보안등 OpenAPI 엔드포인트 |
| `USE_MOCK_FACILITIES` | `true`이면 bbox 내 mock 보안등·안심벨만 사용 (파출소 mock 없음) |

### 파출소(전국) 설정

1. `.env.local`에 `ODCLOUD_SERVICE_KEY`, `VWORLD_API_KEY` 입력
2. `USE_MOCK_FACILITIES=false` 설정
3. 첫 요청 시 경찰청 API + Vworld 지오코딩 실행 후 **24시간 캐시** (`.cache/police-stations-daily.json`)
4. 이후 같은 날에는 캐시만 사용 — API 재호출 없음

선택: `npm run build:police-stations`로 `src/data/police-stations.json` 수동 생성 가능

## Vercel 배포

1. GitHub 저장소에 push
2. Vercel에서 프로젝트 Import (Framework: Next.js)
3. Environment Variables에 위 변수 등록
4. Deploy

`vercel.json`에서 `/api/facilities`, `/api/roads` 함수 `maxDuration`을 30초로 설정했습니다. Pro 플랜에서 더 긴 타임아웃이 필요하면 값을 조정하세요.

## 게임 규칙

- WASD/방향키 또는 모바일 조이스틱으로 **도로 위에서만** 이동
- 좀비 추격, 보안등(감속), 파출소(도망), 안심벨(10초 후 5초 전역 사이렌)
- 집(도착지) **20m 이내** 도달 시 승리, 체력 0이면 패배

## API Routes

- `GET /api/geocode?q=` — VWorld 검색 → Kakao → Nominatim
- `GET /api/map-tiles/{z}/{x}/{y}.png` — VWorld Hybrid 배경지도 (실패 시 OSM)
- `GET /api/roads?south&west&north&east` — Overpass 도로/역 데이터
- `GET /api/buildings?south&west&north&east` — VWorld 건축물(LT_C_BLDGINFO) → Overpass 폴백
- `GET /api/facilities?south&west&north&east` — 시설물 통합 (adapter + bbox 필터 + 캐시)

adapter 필드 매핑은 `src/lib/public-data/adapters/`에서 API 응답 형식에 맞게 수정할 수 있습니다.