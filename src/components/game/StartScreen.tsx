"use client";

import { useEffect, useRef, useState } from "react";
import { fetchGeocodeSuggestions } from "@/lib/api-client";
import { primaryLabelForGeocode } from "@/lib/geocode/format-korean-address";
import type { GeocodeResult } from "@/lib/game/types";

interface StartScreenProps {
  visible: boolean;
  loading: boolean;
  loadingLabel: string;
  onStart: (start: GeocodeResult, end: GeocodeResult) => void;
  onToast: (msg: string) => void;
}

function AddressField({
  label,
  placeholder,
  value,
  selected,
  onValueChange,
  onSelect,
}: {
  label: string;
  placeholder: string;
  value: string;
  selected: GeocodeResult | null;
  onValueChange: (value: string) => void;
  onSelect: (value: GeocodeResult) => void;
}) {
  const [items, setItems] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const search = (query: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setItems(await fetchGeocodeSuggestions(query, 5));
      setOpen(true);
    }, 350);
  };

  return (
    <div className="relative">
      <label className="mb-0.5 block text-sm font-semibold text-slate-200 sm:text-sm">
        {label}
      </label>
      <input
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => {
          onValueChange(event.target.value);
          search(event.target.value);
        }}
        className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 sm:rounded-xl sm:px-4 sm:py-3"
      />
      {selected && (
        <span className="mt-0.5 block text-sm text-emerald-400">선택 완료</span>
      )}
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 shadow-2xl sm:max-h-48 sm:rounded-xl">
          {items.length === 0 && (
            <li className="p-3 text-center text-sm text-slate-400">검색 결과가 없습니다.</li>
          )}
          {items.map((item, index) => (
            <li key={`${item.lat}-${item.lng}-${index}`}>
              <button
                type="button"
                className="w-full border-b border-slate-700 px-3 py-2 text-left transition hover:bg-slate-800 focus:bg-slate-800 sm:px-4 sm:py-2.5"
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <strong className="block text-sm text-white sm:text-sm">
                  {item.name ?? primaryLabelForGeocode(item)}
                </strong>
                <span className="mt-0.5 block text-sm text-slate-400">
                  {item.roadAddress ?? item.jibunAddress ?? item.displayName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [start, setStart] = useState<GeocodeResult | null>(null);
  const [end, setEnd] = useState<GeocodeResult | null>(null);

  if (!visible) return null;

  const submit = async () => {
    if (!startText.trim() || !endText.trim()) {
      onToast("출발지와 목적지를 모두 입력해 주세요.");
      return;
    }
    const resolvedStart = start ?? (await fetchGeocodeSuggestions(startText, 1))[0];
    const resolvedEnd = end ?? (await fetchGeocodeSuggestions(endText, 1))[0];
    if (!resolvedStart || !resolvedEnd) {
      onToast("주소를 찾지 못했습니다. 검색 결과에서 주소를 선택해 주세요.");
      return;
    }
    onStart(resolvedStart, resolvedEnd);
  };

  return (
    <div id="startScreen" className="setup-page">
      <div className="setup-page-body start-screen-body">
        <div className="start-screen-inner">
          <div className="start-screen-hero">
            <span className="text-3xl sm:text-4xl" aria-hidden>
              🌙
            </span>
            <h1 className="mt-1 text-xl font-black text-white sm:text-3xl">
              안심 귀가 시뮬레이터
            </h1>
            <p className="mt-1 text-sm text-slate-400 sm:text-sm">
              실제 지도에서 안전한 귀갓길을 체험하세요.
            </p>
          </div>

          <div className="start-screen-fields space-y-3">
            <AddressField
              label="출발지"
              placeholder="예: 강남역"
              value={startText}
              selected={start}
              onValueChange={(value) => {
                setStartText(value);
                setStart(null);
              }}
              onSelect={(item) => {
                setStart(item);
                setStartText(primaryLabelForGeocode(item));
              }}
            />
            <AddressField
              label="목적지"
              placeholder="예: 서울시청"
              value={endText}
              selected={end}
              onValueChange={(value) => {
                setEndText(value);
                setEnd(null);
              }}
              onSelect={(item) => {
                setEnd(item);
                setEndText(primaryLabelForGeocode(item));
              }}
            />
          </div>

          <p className="start-screen-hint text-sm leading-snug text-slate-500">
            WASD·방향키 또는 조이스틱으로 이동 · 건물 통과 불가
          </p>
        </div>
      </div>

      <footer className="setup-page-footer">
        <button
          type="button"
          disabled={loading}
          onClick={submit}
          className="setup-primary-btn"
        >
          {loading ? loadingLabel : "귀가 시작"}
          {loading && (
            <span className="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
        </button>
      </footer>
    </div>
  );
}
