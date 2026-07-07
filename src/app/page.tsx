import { GameClient } from "@/components/game/GameClient";
import { resolveGoogleMapsApiKey } from "@/lib/google-maps/loader";

export default function Home() {
  const googleMapsApiKey = resolveGoogleMapsApiKey();
  return <GameClient googleMapsApiKey={googleMapsApiKey} />;
}