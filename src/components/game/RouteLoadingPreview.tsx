"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeFinalDifficulty,
  computeLiveDifficulty,
  difficultyLabel,
  GAME_TIPS,
  type FacilityCounts,
  type LoadingPhase,
  previewBounds,
  projectToPreview,
  type FacilityCounts as FC,
} from "@/lib/game/briefing";
import type { LatLng, NormalizedFacility } from "@/lib/game/types";

interface RouteLoadingPreviewProps {
  visible: boolean;
  ready: boolean;
  phase: LoadingPhase;
  loadingLabel: string;
  start: LatLng | null;
  end: LatLng | null;
  routePoints: LatLng[];
  roadsSnapped: boolean;
  facilities: NormalizedFacility[];
  counts: FacilityCounts;
  distanceM: number;
  recommendation: string;
  onBegin: () => void;
}

const EMPTY_COUNTS: FC = {
  light: 0,
  cctv: 0,
  police: 0,
  bell: 0,
  store: 0,
};

function useAnimatedCounts(target: FacilityCounts, active: boolean): FacilityCounts {
  const [display, setDisplay] = useState<FacilityCounts>(EMPTY_COUNTS);

  useEffect(() => {
    if (!active) {
      setDisplay(EMPTY_COUNTS);
      return;
    }

    const start = performance.now();
    const duration = 900;
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - (1 - t) ** 3;
      setDisplay({
        light: Math.round(target.light * ease),
        cctv: Math.round(target.cctv * ease),
        police: Math.round(target.police * ease),
        bell: Math.round(target.bell * ease),
        store: Math.round(target.store * ease),
      });
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    active,
    target.light,
    target.cctv,
    target.police,
    target.bell,
    target.store,
  ]);

  return display;
}

function Minimap({
  start,
  end,
  routePoints,
  roadsSnapped,
  facilities,
  showFacilityMarkers,
}: {
  start: LatLng;
  end: LatLng;
  routePoints: LatLng[];
  roadsSnapped: boolean;
  facilities: NormalizedFacility[];
  showFacilityMarkers: boolean;
}) {
  const width = 320;
  const height = 200;
  const padding = 16;

  const bounds = useMemo(
    () => previewBounds(start, end, showFacilityMarkers ? facilities : []),
    [start, end, facilities, showFacilityMarkers],
  );

  const projected = routePoints.map((p) =>
    projectToPreview(p, bounds, width, height, padding),
  );
  const pathD =
    projected.length >= 2
      ? projected.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
      : "";

  const startPt = projectToPreview(start, bounds, width, height, padding);
  const endPt = projectToPreview(end, bounds, width, height, padding);

  const markers = showFacilityMarkers
    ? facilities.filter((f) => f.type === "police" || f.type === "store").slice(0, 40)
    : [];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="route-preview-map w-full rounded-xl border border-slate-600 bg-slate-950/80"
      role="img"
      aria-label="귀가 경로 미리보기"
    >
      <rect x={0} y={0} width={width} height={height} fill="#0f172a" rx={12} />
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.5" />
      </pattern>
      <rect width={width} height={height} fill="url(#grid)" />

      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={roadsSnapped ? "#38bdf8" : "#64748b"}
          strokeWidth={roadsSnapped ? 3 : 2}
          strokeDasharray={roadsSnapped ? "none" : "6 5"}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={roadsSnapped ? "route-preview-path-snapped" : "route-preview-path-draft"}
        />
      )}

      {showFacilityMarkers &&
        markers.map((f) => {
          const { x, y } = projectToPreview(f, bounds, width, height, padding);
          return (
            <g key={f.id}>
              <circle
                cx={x}
                cy={y}
                r={5}
                fill={f.type === "police" ? "#3b82f6" : "#f59e0b"}
                opacity={0.9}
                className="route-preview-facility-pop"
              />
              <text x={x} y={y + 1} textAnchor="middle" fontSize={7} dominantBaseline="middle">
                {f.type === "police" ? "🚓" : "🏪"}
              </text>
            </g>
          );
        })}

      <circle cx={startPt.x} cy={startPt.y} r={7} fill="#ef4444" />
      <text x={startPt.x} y={startPt.y + 1} textAnchor="middle" fontSize={9} dominantBaseline="middle">
        🚩
      </text>
      <circle cx={endPt.x} cy={endPt.y} r={7} fill="#22c55e" />
      <text x={endPt.x} y={endPt.y + 1} textAnchor="middle" fontSize={9} dominantBaseline="middle">
        🏠
      </text>
    </svg>
  );
}

export function RouteLoadingPreview({
  visible,
  ready,
  phase,
  loadingLabel,
  start,
  end,
  routePoints,
  roadsSnapped,
  facilities,
  counts,
  distanceM,
  recommendation,
  onBegin,
}: RouteLoadingPreviewProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const maxDifficulty = useRef(0);

  const countsActive = phase === "facilities" || phase === "buildings" || ready;
  const animatedCounts = useAnimatedCounts(counts, countsActive);

  useEffect(() => {
    if (!visible) {
      setElapsedMs(0);
      maxDifficulty.current = 0;
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - t0);
    }, 120);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % GAME_TIPS.length);
    }, 4200);
    return () => clearInterval(id);
  }, [visible]);

  const liveDifficulty = computeLiveDifficulty(
    ready ? "ready" : phase,
    distanceM,
    animatedCounts,
    elapsedMs,
  );
  const finalDifficulty = computeFinalDifficulty(distanceM, counts);
  const displayDifficulty = ready
    ? finalDifficulty
    : Math.max(maxDifficulty.current, liveDifficulty);
  if (!ready) maxDifficulty.current = displayDifficulty;

  if (!visible || !start || !end) return null;

  const facilityLines = [
    { key: "light", emoji: "💡", label: "가로등", count: animatedCounts.light },
    { key: "police", emoji: "🚓", label: "지구대·파출소", count: animatedCounts.police },
    { key: "bell", emoji: "🔔", label: "귀가안심벨", count: animatedCounts.bell },
    { key: "cctv", emoji: "📹", label: "CCTV", count: animatedCounts.cctv },
    { key: "store", emoji: "🏪", label: "편의점", count: animatedCounts.store },
  ] as const;

  const phaseSteps: { id: LoadingPhase; label: string }[] = [
    { id: "roads", label: "도로 분석" },
    { id: "facilities", label: "안전시설" },
    { id: "buildings", label: "건물 지형" },
    { id: "ready", label: "준비 완료" },
  ];

  const phaseOrder: LoadingPhase[] = ["init", "roads", "facilities", "buildings", "ready"];
  const phaseIdx = phaseOrder.indexOf(ready ? "ready" : phase);

  return (
    <div className="route-preview-layer ui-layer overflow-y-auto px-4 py-6">
      <main className="route-preview-card w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900/95 p-5 shadow-2xl sm:p-7">
        <div className="mb-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {ready ? "귀가 준비 완료" : "귀가 경로 펼치는 중"}
          </p>
          <h2 className="mt-1 text-xl font-black text-white sm:text-2xl">
            {ready ? "오늘의 귀가 난이도" : loadingLabel}
          </h2>
        </div>

        <Minimap
          start={start}
          end={end}
          routePoints={routePoints}
          roadsSnapped={roadsSnapped}
          facilities={facilities}
          showFacilityMarkers={countsActive}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {phaseSteps.map((step) => {
            const stepIdx = phaseOrder.indexOf(step.id);
            const done = phaseIdx > stepIdx || ready;
            const current = !ready && phase === step.id;
            return (
              <span
                key={step.id}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : current
                      ? "bg-blue-500/25 text-blue-200 ring-1 ring-blue-400/50"
                      : "bg-slate-800 text-slate-500"
                }`}
              >
                {done ? "✓ " : current ? "◐ " : "○ "}
                {step.label}
              </span>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <span className="text-xs text-slate-400">귀가 난이도</span>
              <p className="text-2xl font-black text-amber-300">
                {displayDifficulty}
                <span className="ml-2 text-sm font-semibold text-slate-300">
                  {difficultyLabel(displayDifficulty)}
                </span>
              </p>
            </div>
            <span className="text-sm text-slate-400">
              약 {(distanceM / 1000).toFixed(1)}km
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="route-preview-difficulty-bar h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 transition-all duration-300"
              style={{ width: `${displayDifficulty}%` }}
            />
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {facilityLines.map((line) => (
            <li
              key={line.key}
              className={`rounded-xl px-3 py-2 text-sm transition-all duration-500 ${
                line.count > 0 || countsActive
                  ? "bg-slate-800/80 text-slate-100"
                  : "bg-slate-900/40 text-slate-500"
              }`}
            >
              {countsActive || ready ? (
                <>
                  <span className="mr-1">{line.emoji}</span>
                  내 귀가길 근처에 <strong className="text-white">{line.label}</strong>이{" "}
                  <strong className="text-sky-300">{line.count.toLocaleString()}개</strong> 있어요.
                </>
              ) : (
                <>
                  <span className="mr-1">{line.emoji}</span>
                  {line.label} 스캔 대기 중…
                </>
              )}
            </li>
          ))}
        </ul>

        {ready && (
          <div className="mt-4 rounded-2xl border border-slate-600 bg-slate-950/60 p-4 text-sm text-slate-200">
            <p className="font-semibold text-white">📍 이번 구간 요약</p>
            <p className="mt-2 leading-relaxed">
              보안등 {counts.light.toLocaleString()} · CCTV {counts.cctv.toLocaleString()} ·
              파출소 {counts.police.toLocaleString()} · 편의점 {counts.store.toLocaleString()}
            </p>
            <p className="mt-2 text-slate-300">예상 거리 {(distanceM / 1000).toFixed(1)}km · {recommendation}</p>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">
          <span className="text-xs font-semibold text-blue-300">💡 게임 팁</span>
          <p className="mt-1 leading-relaxed">{GAME_TIPS[tipIndex]}</p>
        </div>

        {ready ? (
          <button
            type="button"
            onClick={onBegin}
            className="mt-6 flex w-full items-center justify-center rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg transition hover:bg-emerald-500"
          >
            귀가 시작
          </button>
        ) : (
          <div className="mt-6 flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            지도를 펼치는 중…
          </div>
        )}
      </main>
    </div>
  );
}
