"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeocodeResult } from "@/lib/game/types";
import { primaryLabelForGeocode } from "@/lib/geocode/format-korean-address";
import { fetchGeocodeSuggestions } from "@/lib/api-client";

interface StartScreenProps {
  visible: boolean;
  loading: boolean;
  loadingLabel: string;
  onStart: (start: GeocodeResult, end: GeocodeResult) => void;
  onToast: (msg: string) => void;
}

function SuggestionList({
  items,
  onSelect,
}: {
  items: GeocodeResult[];
  onSelect: (item: GeocodeResult) => void;
}) {
  if (items.length === 0) {
    return (
      <li className="px-4 py-3 text-sm text-gray-400 text-center">검색 결과가 없습니다.</li>
    );
  }
  return (
    <>
      {items.map((item, idx) => (
        <li
          key={`${item.lat}-${item.lng}-${idx}`}
          className="px-4 py-3 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 border-b border-gray-700 last:border-b-0 transition-colors"
          onClick={() => onSelect(item)}
        >
          {item.name && (
            <div className="font-bold text-white mb-1">{item.name}</div>
          )}
          {item.roadAddress && (
            <div className="text-xs text-gray-300">
              <span className="text-blue-300">도로명</span> {item.roadAddress}
            </div>
          )}
          {item.jibunAddress && (
            <div className="text-xs text-gray-400 mt-0.5">
              <span className="text-gray-500">지번</span> {item.jibunAddress}
            </div>
          )}
          {!item.roadAddress && !item.jibunAddress && item.displayName && (
            <div className="text-xs text-gray-400 line-clamp-2">{item.displayName}</div>
          )}
        </li>
      ))}
    </>
  );
}

export function StartScreen({
  visible,
  loading,
  loadingLabel,
  onStart,
  onToast,
}: StartScreenProps) {
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [startPick, setStartPick] = useState<GeocodeResult | null>(null);
  const [endPick, setEndPick] = useState<GeocodeResult | null>(null);
  const [startSuggestions, setStartSuggestions] = useState<GeocodeResult[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<GeocodeResult[]>([]);
  const [showStartList, setShowStartList] = useState(false);
  const [showEndList, setShowEndList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSuggestions = useCallback(
    (query: string, isStart: boolean) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.length < 2) {
        if (isStart) {
          setStartSuggestions([]);
          setShowStartList(false);
        } else {
          setEndSuggestions([]);
          setShowEndList(false);
        }
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const results = await fetchGeocodeSuggestions(query, 5);
        if (isStart) {
          setStartSuggestions(results);
          setShowStartList(true);
        } else {
          setEndSuggestions(results);
          setShowEndList(true);
        }
      }, 500);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleGps = () => {
    if (!navigator.geolocation) {
      onToast("GPS를 지원하지 않는 브라우저입니다.");
      return;
    }
    onToast("GPS 위치 확인 중...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStartPick({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: "내 위치 (GPS)",
        });
        setStartText("내 위치 (GPS)");
        onToast("GPS 위치 적용 완료");
      },
      () => onToast("GPS 권한이 거부되었거나 실패했습니다."),
    );
  };

  const handleSubmit = async () => {
    if (!startText.trim() || !endText.trim()) {
      onToast("출발지와 도착지를 모두 입력해주세요.");
      return;
    }
    let start = startPick;
    let end = endPick;
    if (!start) {
      const results = await fetchGeocodeSuggestions(startText, 1);
      start = results[0] ?? null;
    }
    if (!end) {
      const results = await fetchGeocodeSuggestions(endText, 1);
      end = results[0] ?? null;
    }
    if (!start) {
      onToast("출발지 주소를 찾을 수 없습니다.");
      return;
    }
    if (!end) {
      onToast("도착지 주소를 찾을 수 없습니다.");
      return;
    }
    onStart(start, end);
  };

  if (!visible) return null;

  return (
    <div id="startScreen" className="ui-layer">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-gray-700">
        <h1 className="text-3xl font-extrabold text-blue-400 mb-2 text-center">
          안심 귀가 시뮬레이터
        </h1>
        <p className="text-gray-400 text-sm mb-6 text-center">실제 지도 기반 생존 게임</p>

        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              출발지 (지하철역, 정류장 등)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                autoComplete="off"
                value={startText}
                onChange={(e) => {
                  setStartText(e.target.value);
                  setStartPick(null);
                  runSuggestions(e.target.value, true);
                }}
                placeholder="예: 강남역, 테헤란로 152"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleGps}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition"
                title="현재 내 위치"
              >
                📍 GPS
              </button>
            </div>
            {showStartList && (
              <ul className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-lg mt-1 max-h-48 overflow-y-auto shadow-xl top-full left-0 text-left">
                <SuggestionList
                  items={startSuggestions}
                  onSelect={(item) => {
                    setStartPick(item);
                    setStartText(primaryLabelForGeocode(item));
                    setShowStartList(false);
                  }}
                />
              </ul>
            )}
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-gray-300 mb-1">도착지 (우리집)</label>
            <input
              type="text"
              autoComplete="off"
              value={endText}
              onChange={(e) => {
                setEndText(e.target.value);
                setEndPick(null);
                runSuggestions(e.target.value, false);
              }}
              placeholder="예: 서초구 래미안, 올림픽로 300"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
            {showEndList && (
              <ul className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-lg mt-1 max-h-48 overflow-y-auto shadow-xl top-full left-0 text-left">
                <SuggestionList
                  items={endSuggestions}
                  onSelect={(item) => {
                    setEndPick(item);
                    setEndText(primaryLabelForGeocode(item));
                    setShowEndList(false);
                  }}
                />
              </ul>
            )}
          </div>

          <div className="bg-gray-900/50 p-4 rounded-lg text-sm text-gray-300 mt-4 border border-gray-700">
            <p className="font-bold text-white mb-2">💡 기믹 안내</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <span className="text-yellow-400">가로등(💡)</span>: 주변 좀비 속도 대폭 감소
              </li>
              <li>
                <span className="text-blue-400">파출소(🚓)</span>: 접근하는 좀비 즉시 퇴치(도망)
              </li>
              <li>
                <span className="text-red-400">안심벨(🚨)</span>: 터치(클릭) 시 10초 뒤 맵 전체 경찰
                사이렌 발동
              </li>
            </ul>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleSubmit}
          className="w-full mt-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-xl font-bold text-lg shadow-[0_0_15px_rgba(37,99,235,0.4)] transition-all flex justify-center items-center"
        >
          <span>{loading ? loadingLabel : "귀가 시작"}</span>
          {loading && (
            <div className="ml-2 w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
        </button>
        <p className="text-xs text-gray-500 mt-4 text-center">
          ※ 파출소·보안등·CCTV는 전국 JSON 데이터, 안심벨만 구간 API(또는 mock)입니다.
        </p>
      </div>
    </div>
  );
}