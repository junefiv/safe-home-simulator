"use client";

import dynamic from "next/dynamic";

const Game = dynamic(
  () => import("./Game").then((mod) => ({ default: mod.Game })),
  { ssr: false },
);

interface GameClientProps {
  googleMapsApiKey?: string;
}

export function GameClient({ googleMapsApiKey = "" }: GameClientProps) {
  return <Game googleMapsApiKey={googleMapsApiKey} />;
}