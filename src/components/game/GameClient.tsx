"use client";

import dynamic from "next/dynamic";

const Game = dynamic(
  () => import("./Game").then((mod) => ({ default: mod.Game })),
  { ssr: false },
);

export function GameClient() {
  return <Game />;
}