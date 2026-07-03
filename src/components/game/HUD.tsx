"use client";

interface HUDProps {
  hp: number;
  maxHp: number;
  distToHome: number | null;
  sirenActive: boolean;
}

export function HUD({ hp, maxHp, distToHome, sirenActive }: HUDProps) {
  let hearts = "";
  for (let i = 0; i < maxHp; i++) {
    hearts += i < hp ? "❤️" : "🖤";
  }

  return (
    <div id="hud">
      <div className="text-xl font-bold text-blue-400 mb-2">상태 정보</div>
      <div className="text-red-400 font-bold text-lg">체력: {hearts}</div>
      <div className="text-green-400 font-bold mt-1">
        집까지 거리: {distToHome === null ? "계산 중..." : `${Math.floor(distToHome)}m`}
      </div>
      {sirenActive && (
        <div className="text-yellow-400 font-bold mt-3 animate-pulse">
          🚨 사이렌 발동! 좀비들이 도망갑니다!
        </div>
      )}
    </div>
  );
}