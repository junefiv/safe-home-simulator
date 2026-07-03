"use client";

interface EndScreensProps {
  gameState: "GAMEOVER" | "VICTORY" | null;
  onRestart: () => void;
}

export function EndScreens({ gameState, onRestart }: EndScreensProps) {
  if (gameState === "GAMEOVER") {
    return (
      <div className="ui-layer">
        <h1 className="text-6xl font-black text-red-500 mb-4">귀가 실패...</h1>
        <p className="text-xl text-gray-300 mb-8">좀비에게 잡히고 말았습니다.</p>
        <button
          type="button"
          onClick={onRestart}
          className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-full font-bold text-xl transition-all"
        >
          처음부터 다시
        </button>
      </div>
    );
  }

  if (gameState === "VICTORY") {
    return (
      <div className="ui-layer">
        <h1 className="text-6xl font-black text-green-400 mb-4">무사 귀가 성공!</h1>
        <p className="text-xl text-gray-300 mb-8">안전하게 집에 도착했습니다.</p>
        <button
          type="button"
          onClick={onRestart}
          className="px-8 py-4 bg-green-600 hover:bg-green-500 text-white rounded-full font-bold text-xl transition-all"
        >
          처음부터 다시
        </button>
      </div>
    );
  }

  return null;
}