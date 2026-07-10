"use client";

interface HUDProps {
  hp: number;
  maxHp: number;
  distToHome: number | null;
  sirenActive: boolean;
  zombieCount: number;
}

export function HUD({
  hp,
  maxHp,
  distToHome,
  sirenActive,
  zombieCount,
}: HUDProps) {
  const hearts = Array.from({ length: maxHp }, (_, index) =>
    index < hp ? "♥" : "♡",
  ).join("");

  return (
    <aside id="hud" aria-label="게임 상태">
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
      {sirenActive && (
        <div className="siren-alert" role="status">
          ⚡ 안전시설 효과가 발동 중입니다
        </div>
      )}
    </aside>
  );
}
