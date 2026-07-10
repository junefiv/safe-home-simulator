"use client";

interface EndScreensProps {
  gameState: "GAMEOVER" | "VICTORY" | null;
  onRestart: () => void;
}

export function EndScreens({ gameState, onRestart }: EndScreensProps) {
  if (!gameState) return null;
  const victory = gameState === "VICTORY";
  return (
    <div className="ui-layer ui-layer-overlay px-6 text-center" role="dialog" aria-modal="true">
      <div className="text-6xl" aria-hidden>{victory ? "🏠" : "🧟"}</div>
      <h1 className={`mt-5 text-5xl font-black ${victory ? "text-emerald-400" : "text-rose-500"}`}>
        {victory ? "무사 귀가 성공!" : "귀가 실패"}
      </h1>
      <p className="mb-8 mt-4 text-lg text-slate-300">
        {victory ? "안전하게 목적지에 도착했습니다." : "좀비에게 붙잡혔습니다. 다른 길로 다시 도전해 보세요."}
      </p>
      <button type="button" onClick={onRestart} className={`rounded-full px-8 py-4 text-lg font-bold text-white transition ${victory ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"}`}>
        처음부터 다시
      </button>
    </div>
  );
}
