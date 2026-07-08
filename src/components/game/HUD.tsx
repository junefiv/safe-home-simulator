"use client";

import type { MovementLayer } from "@/lib/game/types";

interface HUDProps {
  hp: number;
  maxHp: number;
  distToHome: number | null;
  sirenActive: boolean;
  movementLayer: MovementLayer;
  zombieCount: number;
  mapDataLoading: boolean;
}

export function HUD({
  hp,
  maxHp,
  distToHome,
  sirenActive,
  movementLayer,
  zombieCount,
  mapDataLoading,
}: HUDProps) {
  const hearts = Array.from({ length: maxHp }, (_, index) =>
    index < hp ? "♥" : "♡",
  ).join("");
  const underground = movementLayer === "underground";

  return (
    <aside id="hud" aria-label="게임 상태">
      <div className="hud-topline">
        <span className={`layer-badge ${underground ? "underground" : "surface"}`}>
          {underground ? "🚇 지하철" : "🌙 지상"}
        </span>
        {mapDataLoading && <span className="map-loading">주변 지도 준비 중</span>}
      </div>
      <div className="hud-grid">
        <div>
          <span className="hud-label">체력</span>
          <strong className="hud-hearts" aria-label={`${hp}/${maxHp}`}>
            {hearts}
          </strong>
        </div>
        <div>
          <span className="hud-label">집까지</span>
          <strong>{distToHome === null ? "계산 중" : `${Math.floor(distToHome)}m`}</strong>
        </div>
        <div>
          <span className="hud-label">추격 중</span>
          <strong>{zombieCount}명</strong>
        </div>
      </div>
      {underground && <p className="hud-hint">역에서만 지상으로 나갈 수 있습니다.</p>}
      {sirenActive && (
        <div className="siren-alert" role="status">
          ⚡ 안전시설 효과가 발동 중입니다
        </div>
      )}
    </aside>
  );
}
