#!/usr/bin/env python3
"""
.cache/CCTV정보.csv, .cache/안전비상벨위치정보.csv → JSON 변환

사용법 (프로젝트 루트에서):
  python scripts/convert_facility_csv.py
  npm run convert:facility-csv
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache"

CCTV_CSV = CACHE_DIR / "CCTV정보.csv"
BELL_CSV = CACHE_DIR / "안전비상벨위치정보.csv"
OUT_CCTV = CACHE_DIR / "cctv-stations.json"
OUT_BELL = CACHE_DIR / "emergency-bells.json"

# 공공데이터 CSV는 대부분 cp949(Windows-949). euc-kr 고정 시 일부 바이트에서 실패함.
ENCODING_CANDIDATES = ("cp949", "utf-8-sig", "utf-8", "euc-kr")


def detect_encoding(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ENCODING_CANDIDATES:
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    # 마지막 수단: cp949 + 치환 (좌표·주소는 대부분 ASCII/한글로 충분)
    return "cp949"


def read_csv_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    if not path.is_file():
        raise FileNotFoundError(f"CSV 없음: {path}")

    encoding = detect_encoding(path)
    with path.open("r", encoding=encoding, newline="") as f:
        rows = list(csv.reader(f))

    if not rows:
        return [], []

    headers = [h.strip() for h in rows[0]]
    return headers, rows[1:]


def col_index(headers: list[str], name: str) -> int:
    try:
        return headers.index(name)
    except ValueError:
        return -1


def require_columns(headers: list[str], names: list[str], label: str) -> None:
    missing = [n for n in names if col_index(headers, n) < 0]
    if missing:
        raise ValueError(
            f"{label} CSV에 필수 컬럼이 없습니다: {', '.join(missing)}\n"
            f"  실제 헤더: {headers}"
        )


def at(row: list[str], index: int) -> str:
    if index < 0 or index >= len(row):
        return ""
    return row[index].strip()


def coord_key(lat: float, lng: float) -> str:
    return f"{lat:.5f}:{lng:.5f}"


def is_korea_coord(lat: float, lng: float) -> bool:
    return 33.0 <= lat <= 39.0 and 124.0 <= lng <= 132.5


def convert_cctv() -> list[dict]:
    headers, rows = read_csv_rows(CCTV_CSV)
    require_columns(
        headers,
        ["WGS84위도", "WGS84경도", "관리번호"],
        "CCTV",
    )
    idx_lat = col_index(headers, "WGS84위도")
    idx_lng = col_index(headers, "WGS84경도")
    idx_id = col_index(headers, "관리번호")
    idx_purpose = col_index(headers, "설치목적구분")
    idx_road = col_index(headers, "소재지도로명주소")
    idx_jibun = col_index(headers, "소재지지번주소")

    facilities: list[dict] = []
    seen: set[str] = set()

    for i, row in enumerate(rows, start=1):
        if not any(cell.strip() for cell in row):
            continue
        try:
            lat = float(at(row, idx_lat))
            lng = float(at(row, idx_lng))
        except ValueError:
            continue
        if not is_korea_coord(lat, lng):
            continue

        key = coord_key(lat, lng)
        if key in seen:
            continue
        seen.add(key)

        purpose = at(row, idx_purpose) or "방범"
        mgmt = at(row, idx_id) or str(i)
        address = at(row, idx_road) or at(row, idx_jibun)

        facilities.append(
            {
                "id": f"cctv-{mgmt}",
                "type": "cctv",
                "lat": lat,
                "lng": lng,
                "name": f"{purpose} CCTV",
                "address": address,
            }
        )

    return facilities


def convert_bells() -> list[dict]:
    headers, rows = read_csv_rows(BELL_CSV)
    require_columns(
        headers,
        ["WGS84위도", "WGS84경도", "관리번호"],
        "안전비상벨",
    )
    idx_lat = col_index(headers, "WGS84위도")
    idx_lng = col_index(headers, "WGS84경도")
    idx_id = col_index(headers, "관리번호")
    idx_location = col_index(headers, "설치위치")
    idx_bell_mgmt = col_index(headers, "안전비상벨관리번호")
    idx_road = col_index(headers, "소재지도로명주소")
    idx_jibun = col_index(headers, "소재지지번주소")

    facilities: list[dict] = []
    seen: set[str] = set()

    for i, row in enumerate(rows, start=1):
        if not any(cell.strip() for cell in row):
            continue
        try:
            lat = float(at(row, idx_lat))
            lng = float(at(row, idx_lng))
        except ValueError:
            continue
        if not is_korea_coord(lat, lng):
            continue

        key = coord_key(lat, lng)
        if key in seen:
            continue
        seen.add(key)

        mgmt = at(row, idx_id) or str(i)
        name = at(row, idx_location) or at(row, idx_bell_mgmt) or "안전비상벨"
        address = at(row, idx_road) or at(row, idx_jibun)

        facilities.append(
            {
                "id": f"bell-{mgmt}",
                "type": "bell",
                "lat": lat,
                "lng": lng,
                "name": name,
                "address": address,
            }
        )

    return facilities


def write_json(path: Path, data: list[dict]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    errors: list[str] = []
    converted = 0

    try:
        cctv = convert_cctv()
        write_json(OUT_CCTV, cctv)
        print(f"[CCTV] {len(cctv):,}건 → {OUT_CCTV}")
        converted += 1
    except FileNotFoundError as e:
        errors.append(str(e))
    except Exception as e:
        errors.append(f"CCTV 변환 실패: {e}")

    try:
        bells = convert_bells()
        write_json(OUT_BELL, bells)
        print(f"[비상벨] {len(bells):,}건 → {OUT_BELL}")
        converted += 1
    except FileNotFoundError as e:
        errors.append(str(e))
    except Exception as e:
        errors.append(f"비상벨 변환 실패: {e}")

    if errors:
        for msg in errors:
            print(f"경고: {msg}", file=sys.stderr)

    if converted == 0:
        print(
            "\n변환된 파일이 없습니다. .cache/ 에 CSV를 넣었는지 확인하세요:\n"
            f"  - {CCTV_CSV.name}\n"
            f"  - {BELL_CSV.name}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
