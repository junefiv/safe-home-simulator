"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeSafetyScore,
  FACILITY_GIMMICKS,
  GAME_TIPS,
  previewMapMarkers,
  previewBounds,
  projectToPreview,
  safetyBarPercent,
  safetyLabel,
  type FacilityCounts,
  type LoadingPhase,
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

const EMPTY_COUNTS: FacilityCounts = {
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

  return active ? display : EMPTY_COUNTS;
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
  const width = 420;
  const height = 360;
  const padding = 14;

  const bounds = useMemo(
    () => previewBounds(start, end, routePoints, showFacilityMarkers ? facilities : []),
    [start, end, routePoints, facilities, showFacilityMarkers],
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

  const markers = showFacilityMarkers ? previewMapMarkers(facilities) : [];

  return (
    <div className="briefing-map-host">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="briefing-map-svg"
        role="img"
        aria-label="귀가 경로 미리보기"
      >
        <rect x={0} y={0} width={width} height={height} fill="#0f172a" rx={10} />
        <pattern id="briefing-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.5" />
        </pattern>
        <rect width={width} height={height} fill="url(#briefing-grid)" />

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

        {markers.map((m) => {
          const { x, y } = projectToPreview(
            { lat: m.lat, lng: m.lng },
            bounds,
            width,
            height,
            padding,
          );
          const cx = x + m.xOffset;
          return (
            <g key={m.id}>
              <circle cx={cx} cy={y} r={5} fill="#1e293b" opacity={0.9} />
              <text x={cx} y={y + 1} textAnchor="middle" fontSize={7} dominantBaseline="middle">
                {m.emoji}
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
    </div>
  );
}

function FacilityGimmickHelp() {
  return (
    <div className="facility-gimmick-help group relative inline-flex">
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 bg-slate-800 text-sm font-bold text-slate-200"
        aria-label="시설물 기믹 설명"
      >
        ?
      </button>
      <div
        className="facility-gimmick-popover pointer-events-none absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-950 p-3 text-left text-sm text-slate-200 opacity-0 shadow-xl"
        role="tooltip"
      >
        <p className="mb-1.5 font-semibold text-white">시설물 기믹</p>
        <ul className="max-h-40 space-y-1.5 overflow-y-auto">
          {FACILITY_GIMMICKS.map((g) => (
            <li key={g.key}>
              <span className="mr-0.5">{g.emoji}</span>
              <strong className="text-sky-200">{g.label}</strong>
              <span className="text-slate-400"> — {g.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
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
  recommendation: _recommendation,
  onBegin,
}: RouteLoadingPreviewProps) {
  const [tipIndex, setTipIndex] = useState(0);

  const countsActive = phase === "facilities" || phase === "buildings" || ready;
  const animatedCounts = useAnimatedCounts(counts, countsActive);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % GAME_TIPS.length);
    }, 4200);
    return () => clearInterval(id);
  }, [visible]);

  const scoreCounts = countsActive || ready ? animatedCounts : EMPTY_COUNTS;
  const safetyScore = computeSafetyScore(distanceM, scoreCounts);
  const safetyDisplay = safetyScore.toFixed(1);

  if (!visible || !start || !end) return null;

  const facilityLines = FACILITY_GIMMICKS.map((g) => ({
    key: g.key,
    emoji: g.emoji,
    label: g.label,
    count: animatedCounts[g.key],
  }));

  const phaseSteps: { id: LoadingPhase; label: string }[] = [
    { id: "roads", label: "도로" },
    { id: "facilities", label: "시설" },
    { id: "buildings", label: "건물" },
    { id: "ready", label: "완료" },
  ];

  const phaseOrder: LoadingPhase[] = ["init", "roads", "facilities", "buildings", "ready"];
  const phaseIdx = phaseOrder.indexOf(ready ? "ready" : phase);

  return (
    <div className="setup-page briefing-page">
      <header className="setup-page-header briefing-header">
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          {ready ? "귀가 준비 완료" : "귀가 경로 분석"}
        </p>
        <h2 className="text-lg font-black text-white sm:text-xl">
          {ready ? "오늘의 안전점수" : loadingLabel}
        </h2>
      </header>

      <div className="setup-page-body briefing-body">
        <div className="briefing-layout">
          <section className="briefing-panel briefing-map-panel">
            <Minimap
              start={start}
              end={end}
              routePoints={routePoints}
              roadsSnapped={roadsSnapped}
              facilities={facilities}
              showFacilityMarkers={countsActive}
            />
            <div className="briefing-phase-row">
              {phaseSteps.map((step) => {
                const stepIdx = phaseOrder.indexOf(step.id);
                const done = phaseIdx > stepIdx || ready;
                const current = !ready && phase === step.id;
                return (
                  <span
                    key={step.id}
                    className={`briefing-phase-pill ${
                      done ? "is-done" : current ? "is-current" : "is-pending"
                    }`}
                  >
                    {done ? "✓" : current ? "◐" : "○"} {step.label}
                  </span>
                );
              })}
              <span className="briefing-phase-note">
                경로 근처 (파출소 120m)
              </span>
            </div>
          </section>

          <aside className="briefing-side">
            <section className="briefing-panel briefing-safety-panel">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-sm text-slate-400">안전점수</span>
                  <p className="text-2xl font-black text-emerald-300 sm:text-3xl">
                    {safetyDisplay}
                    <span className="ml-2 text-sm font-semibold text-slate-300 sm:text-base">
                      {safetyLabel(safetyScore)}
                    </span>
                  </p>
                </div>
                <span className="text-sm text-slate-400">
                  {(distanceM / 1000).toFixed(1)}km
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="route-preview-safety-bar h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400"
                  style={{ width: `${safetyBarPercent(safetyScore)}%` }}
                />
              </div>
              <p className="mt-2 text-sm leading-snug text-slate-400">
                시설점수 ÷ 거리(km)
                <span className="text-slate-500"> · 가로등 제외</span>
              </p>
            </section>

            <section className="briefing-panel briefing-facilities-panel">
              <div className="mb-2 flex items-center justify-between gap-1">
                <h3 className="text-sm font-semibold text-white sm:text-base">
                  경로 근처 시설
                </h3>
                <FacilityGimmickHelp />
              </div>
              <ul className="briefing-facility-grid">
                {facilityLines.map((line) => (
                  <li
                    key={line.key}
                    className={`briefing-facility-item ${
                      line.count > 0 || countsActive ? "is-active" : "is-idle"
                    }`}
                  >
                    <span>{line.emoji}</span>
                    <span className="briefing-facility-label">{line.label}</span>
                    <strong className="briefing-facility-count">
                      {countsActive || ready ? line.count.toLocaleString() : "—"}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <footer className="setup-page-footer briefing-footer">
        <div className="briefing-tip-box" role="note">
          <span className="briefing-tip-badge">TIP</span>
          <p className="briefing-tip-text">{GAME_TIPS[tipIndex]}</p>
        </div>
        {ready ? (
          <button type="button" onClick={onBegin} className="setup-primary-btn is-ready">
            귀가 시작
          </button>
        ) : (
          <div className="setup-loading-row">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />
            <span className="text-sm text-slate-400">지도를 펼치는 중…</span>
          </div>
        )}
      </footer>
    </div>
  );
}
