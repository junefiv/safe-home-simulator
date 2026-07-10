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

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

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
      <label className="mb-1 block text-sm font-semibold text-slate-200">{label}</label>
      <input
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => {
          onValueChange(event.target.value);
          search(event.target.value);
        }}
        className="w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30"
      />
      {selected && <span className="mt-1 block text-xs text-emerald-400">주소 선택 완료</span>}
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 shadow-2xl">
          {items.length === 0 && <li className="p-4 text-center text-sm text-slate-400">검색 결과가 없습니다.</li>}
          {items.map((item, index) => (
            <li key={`${item.lat}-${item.lng}-${index}`}>
              <button
                type="button"
                className="w-full border-b border-slate-700 px-4 py-3 text-left transition hover:bg-slate-800 focus:bg-slate-800"
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <strong className="block text-sm text-white">{item.name ?? primaryLabelForGeocode(item)}</strong>
                <span className="mt-1 block text-xs text-slate-400">{item.roadAddress ?? item.jibunAddress ?? item.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StartScreen({ visible, loading, loadingLabel, onStart, onToast }: StartScreenProps) {
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
    <div id="startScreen" className="ui-layer overflow-y-auto px-4 py-8">
      <main className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 text-center">
          <span className="text-4xl" aria-hidden>🌙</span>
          <h1 className="mt-2 text-3xl font-black text-white">안심 귀가 시뮬레이터</h1>
          <p className="mt-2 text-sm text-slate-400">실제 지도에서 안전한 귀갓길을 체험하세요.</p>
        </div>
        <div className="space-y-4">
          <AddressField label="출발지" placeholder="예: 강남역" value={startText} selected={start} onValueChange={(value) => { setStartText(value); setStart(null); }} onSelect={(item) => { setStart(item); setStartText(primaryLabelForGeocode(item)); }} />
          <AddressField label="목적지" placeholder="예: 서울시청" value={endText} selected={end} onValueChange={(value) => { setEndText(value); setEnd(null); }} onSelect={(item) => { setEnd(item); setEndText(primaryLabelForGeocode(item)); }} />
        </div>
        <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
          <strong className="text-white">이동 안내</strong>
          <p className="mt-2 leading-6">도로·골목·역·아파트 단지로 이동하세요. 건물은 통과할 수 없습니다.</p>
        </div>
        <button type="button" disabled={loading} onClick={submit} className="mt-6 flex w-full items-center justify-center rounded-xl bg-blue-600 py-4 text-lg font-bold text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
          {loading ? loadingLabel : "귀가 시작"}
          {loading && <span className="ml-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">키보드 WASD·방향키 또는 화면 조이스틱으로 이동</p>
      </main>
    </div>
  );
}
