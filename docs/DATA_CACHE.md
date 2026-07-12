# 데이터 캐시 · 갱신 · 배포 가이드

이 문서는 시설물/도로/건물 캐시를 **어떻게 만들고**, **GitHub에 올리지 않고** 어디에 두며, **배포된 사이트에서 어떻게 쓰는지**를 정리합니다.

---

## 1. `build:map-cache`가 `r2-c29 roads...`에서 멈춘 것처럼 보이는 이유

**죽은 게 아니라, 그 칸의 도로 API(VWorld 또는 Overpass) 응답을 기다리는 중일 가능성이 큽니다.**

- `BATCH=1102`면 남은 **960칸을 한 번에** 받으려 해서, 첫 칸(`r2-c29`)에서 오래 걸리면 로그가 그 줄에 고정됩니다.
- 바다·산간·API 지연·타임아웃 재시도 구간에서는 **수 분** 동안 다음 로그가 안 나올 수 있습니다.
- 작업 관리자에 `node ... scripts/build-map-cache.mjs`가 있으면 **아직 실행 중**입니다.
- 진행도는 `.cache/map-cache-progress.json`의 `completed` 개수로 확인합니다. 칸이 성공할 때마다 늘어납니다.

### 권장

- 한 번에 전 칸을 돌리지 말고 `.env.local`에서 `MAP_CACHE_BATCH=20`~`50` 정도로 줄이세요.
- 멈춘 것 같으면 터미널에서 `Ctrl+C`로 중단해도 **이미 완료된 칸은 유지**됩니다. 다음에 `npm run build:map-cache`하면 **이어서** 받습니다.
- 처음부터 다시 받으려면 `MAP_CACHE_FORCE=1` 또는 `npm run build:map-cache:init`(진행도 리셋).

---

## 2. 캐시 갱신 명령어 모음

프로젝트 루트(`C:\safe-home-simulator`)에서 실행합니다.  
API 키가 필요한 작업은 `.env.local`이 있어야 합니다.

### 2-1. 시설물 (전국 JSON → `.cache/`)

| 대상 | 명령어 | 결과 파일 |
|------|--------|-----------|
| 파출소·지구대 | `npm run build:police-stations` | `.cache/police-stations.json` |
| 보안등 (+ 스크립트 내 CCTV WFS 시도) | `npm run build:safemap-facilities` | `.cache/security-lights.json` (및 관련 JSON) |
| 편의점 | `npm run build:convenience-stores` | `.cache/convenience-stores.json` |
| CCTV·비상벨 CSV → JSON | `npm run convert:facility-csv` | `.cache/cctv-stations.json`, `.cache/emergency-bells.json` |
| 시설물 일괄 | `npm run build:facility-cache` | 위 파출소 + 보안등 + CSV 변환 |

**CCTV / 비상벨 CSV 준비**

1. 공공데이터포털에서 CSV 다운로드
2. 파일명을 아래처럼 `.cache/`에 저장  
   - `CCTV정보.csv`  
   - `안전비상벨위치정보.csv`
3. `npm run convert:facility-csv` 실행

### 2-2. 도로 · 건물 (전국 격자 증분 캐시)

| 단계 | 명령어 | 설명 |
|------|--------|------|
| 최초 1회 | `npm run build:map-cache:init` | 전국 격자(~1102칸) 생성, 진행도 리셋 |
| 이어서 받기 | `npm run build:map-cache` | `.env.local`의 `MAP_CACHE_BATCH`만큼 처리 |

**관련 `.env.local` 설정**

```env
MAP_CACHE_BATCH=30
MAP_CACHE_GAP_MS=2000
MAP_CACHE_GRID_STEP=0.2
MAP_CACHE_RETRIES=2
MAP_CACHE_SPLIT_DEPTH=2
# MAP_CACHE_FORCE=1   # 필요할 때만: 완료 칸도 다시 받기
```

샤드는 **gzip 압축**(`*.json.gz`)으로 저장됩니다.  
칸이 실패하면 최대 `MAP_CACHE_RETRIES`번 재시도하고, `Invalid string length` 같은 용량 오류면 칸을 **4분할**해 다시 받습니다.  
그래도 안 되면 `SKIP:` 으로 표시하고 다음 칸으로 넘어갑니다.
**생성되는 위치**

```
.cache/map-cache-bboxes.json      # 전국 격자 목록
.cache/map-cache-progress.json   # 완료/실패/다음 인덱스
.cache/map-cache/index.json      # 샤드 인덱스
.cache/map-cache/roads/*.json
.cache/map-cache/buildings/*.json
```

(구버전) `.cache/roads-cache.json`, `.cache/buildings-cache.json`도 있으면 폴백으로 읽습니다.

### 2-3. 한 번에 (시설물 + 지도 배치 1회)

```powershell
npm run build:all-cache
```

지도는 `MAP_CACHE_BATCH`만큼만 돌고, 전국이 끝날 때까지는 여러 번 `build:map-cache`를 반복해야 합니다.

---

## 3. 왜 GitHub에 올리면 안 되나

`.cache/`는 `.gitignore`에 들어 있습니다.

| 데이터 | 대략 규모 | GitHub |
|--------|-----------|--------|
| 시설물 JSON (보안등·파출소·편의점·CCTV·벨) | 수십~수백 MB | LFS 써도 부담, 비권장 |
| 전국 도로·건물 샤드 | **수 GB 이상** 가능 | **올리면 안 됨** |

GitHub / Git LFS는 이 용도에 맞지 않습니다. 코드만 GitHub에 두고, **데이터는 객체 스토리지**에 두는 것이 맞습니다.

---

## 4. 어디에 올리고, 어디서 배포하면 게임이 데이터를 쓰나

### 현재 코드 동작 (중요)

지금은 서버가 **로컬 디스크의 `.cache/`** 만 읽습니다.

- 시설물: `src/lib/public-data/safemap-bundled.ts` → `.cache/*.json`
- 도로/건물: `src/lib/server/map-cache.ts` → `.cache/map-cache/**` (없으면 **실시간 VWorld/Overpass API**)

그래서:

| 환경 | 시설물 | 도로·건물 |
|------|--------|-----------|
| 로컬 PC (`npm run dev`) | `.cache` 있으면 로드 | 캐시 있으면 캐시, 없으면 API |
| Vercel 등 (Git만 배포) | `.cache` 없음 → 시설물 비거나 오류 | **실시간 API로 동작** (캐시 없이도 가능) |

**지금 당장 Vercel에 코드만 배포해도**, 도로·건물은 API 키만 있으면 게임은 돌아갑니다.  
다만 전국 사전 캐시의 속도·안정성 이점은 없고, 시설물 전국 JSON은 별도 대책이 필요합니다.

---

### 권장 아키텍처

```
[개발 PC]
  npm run build:facility-cache
  npm run build:map-cache   (여러 날 나눠서)

        │ 업로드
        ▼
[객체 스토리지]  ← 대용량 데이터 보관소
  Cloudflare R2 / AWS S3 / Vercel Blob 등
  예: facilities/*.json , map-cache/**/*

        │ 런타임 fetch 또는 빌드 시 동기화
        ▼
[앱 호스팅]  ← Next.js 사이트
  Vercel (또는 Railway / Fly.io 등)
  GitHub에는 코드 + .env(키)만
```

#### A. 사이트 배포 (앱)

- **추천: [Vercel](https://vercel.com)** — 이 프로젝트가 Next.js라 가장 맞음  
  1. GitHub에 **코드만** push (`.cache` 제외 상태 유지)  
  2. Vercel Import → Environment Variables에 `.env.local`과 동일한 API 키 등록  
  3. Deploy  

#### B. 대용량 데이터 보관 (캐시 파일)

| 옵션 | 장점 | 비고 |
|------|------|------|
| **Cloudflare R2** | 저렴, S3 호환, egress 비용 유리 | 추천 |
| **AWS S3** | 표준 | 트래픽 비용 주의 |
| **Vercel Blob** | Vercel과 연동 쉬움 | 용량·요금 확인 |

업로드 예 (로컬에서 R2/S3 CLI):

```powershell
# 예시: AWS CLI / R2 호환 엔드포인트
aws s3 sync .cache/map-cache s3://your-bucket/map-cache --delete
aws s3 cp .cache/security-lights.json s3://your-bucket/facilities/security-lights.json
aws s3 cp .cache/police-stations.json s3://your-bucket/facilities/police-stations.json
aws s3 cp .cache/convenience-stores.json s3://your-bucket/facilities/convenience-stores.json
aws s3 cp .cache/cctv-stations.json s3://your-bucket/facilities/cctv-stations.json
aws s3 cp .cache/emergency-bells.json s3://your-bucket/facilities/emergency-bells.json
```

#### C. 게임이 그 데이터를 읽게 하려면 (코드 작업 필요)

현재는 **스토리지 URL을 읽는 코드가 없습니다.** 배포 후 캐시를 쓰려면 예를 들어:

1. `.env`에 `CACHE_BASE_URL=https://pub-xxxx.r2.dev` (또는 Blob URL) 추가  
2. `safemap-bundled.ts` / `map-cache.ts`가 로컬 파일이 없으면 `CACHE_BASE_URL`에서 JSON을 fetch  
3. 또는 Vercel 빌드 훅에서 `aws s3 sync`로 `.cache`를 채운 뒤 배포 (서버리스는 디스크가 임시라 **런타임 fetch 방식이 더 적합**)

그 전까지의 실용적 선택:

1. **앱 → Vercel** (코드 + API 키)  
2. **도로·건물 → 캐시 없이 실시간 API** (이미 구현됨)  
3. **시설물 →**  
   - 단기: 용량이 허용되면 CI에서 생성해 배포 아티팩트에 포함 (비대용량일 때만)  
   - 중기: R2/Blob + fetch 연동 구현  

---

## 5. 체크리스트

### 로컬에서 게임까지

- [ ] `.env.local` API 키 설정  
- [ ] `npm run build:facility-cache` (또는 개별 명령)  
- [ ] `.cache`에 CSV 넣고 `npm run convert:facility-csv`  
- [ ] `npm run build:map-cache:init` 후 여러 번 `npm run build:map-cache`  
- [ ] `npm run dev`로 플레이  

### 배포 (캐시 연동 전)

- [ ] GitHub에 코드 push (`.cache` 커밋하지 않음)  
- [ ] Vercel 환경 변수 등록 (`VWORLD_*`, `SAFEMAP_*`, `ODCLOUD_*`, Google Maps 등)  
- [ ] 배포 후 도로·건물은 API로 동작하는지 확인  
- [ ] 시설물이 비면 → 스토리지 연동 또는 빌드 파이프라인 추가  

### 배포 (캐시 연동 후, 구현 시)

- [ ] R2/S3/Blob에 `.cache` 업로드  
- [ ] `CACHE_BASE_URL` 등 env 설정  
- [ ] 앱이 스토리지에서 시설물·지도 샤드를 읽도록 코드 반영  

---

## 6. 빠른 참조

```powershell
# 시설물
npm run build:police-stations
npm run build:safemap-facilities
npm run build:convenience-stores
npm run convert:facility-csv
npm run build:facility-cache

# 도로·건물 (증분)
npm run build:map-cache:init
npm run build:map-cache

# 앱
npm run dev
npm run build
```

질문 요약 답:

- **1102칸을 다 채우면?** → 다시 안 돌리고 종료. 재갱신은 `MAP_CACHE_FORCE=1`.  
- **`BATCH`를 줄이면?** → 처음부터가 아니라 **남은 칸만** 이어서 받음.  
- **GitHub에 데이터?** → 올리지 말 것. **앱은 Vercel, 데이터는 R2/S3/Blob.**  
- **지금 Vercel만 배포?** → 도로·건물은 API로 가능. 시설물 전국 JSON·지도 캐시는 스토리지 연동 전까지 로컬 `.cache` 전용.
