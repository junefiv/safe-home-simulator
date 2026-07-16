"use client";

interface EndScreensProps {
  gameState: "GAMEOVER" | "VICTORY" | null;
  canRestartSameRoute: boolean;
  onRestartSameRoute: () => void;
  onRestartFresh: () => void;
}

export function EndScreens({
  gameState,
  canRestartSameRoute,
  onRestartSameRoute,
  onRestartFresh,
}: EndScreensProps) {
  if (!gameState) return null;
  const victory = gameState === "VICTORY";
  const primaryClass = victory
    ? "bg-emerald-600 hover:bg-emerald-500"
    : "bg-rose-600 hover:bg-rose-500";

  return (
    <div className="ui-layer ui-layer-overlay px-6 text-center" role="dialog" aria-modal="true">
      <div className="text-6xl" aria-hidden>{victory ? "🏠" : "🧟"}</div>
      <h1 className={`mt-5 text-5xl font-black ${victory ? "text-emerald-400" : "text-rose-500"}`}>
        {victory ? "무사 귀가 성공!" : "귀가 실패"}
      </h1>
      <p className="mb-8 mt-4 text-lg text-slate-300">
        {victory
          ? "안전하게 목적지에 도착했습니다."
          : "좀비에게 붙잡혔습니다. 같은 경로로 다시 도전하거나 새 출발지를 골라 보세요."}
      </p>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {canRestartSameRoute && (
          <button
            type="button"
            onClick={onRestartSameRoute}
            className={`rounded-full px-8 py-4 text-lg font-bold text-white transition ${primaryClass}`}
          >
            지금 한 경로로 다시하기
          </button>
        )}
        <button
          type="button"
          onClick={onRestartFresh}
          className="rounded-full border-2 border-slate-500 bg-transparent px-8 py-4 text-lg font-bold text-slate-200 transition hover:border-slate-300 hover:bg-slate-800/60"
        >
          새롭게 다시하기
        </button>
      </div>
    </div>
  );
}
