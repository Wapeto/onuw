import type { ReactElement } from "react";
import type { NightTickId } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useFullscreen } from "../hooks/useFullscreen";
import DummyScreen from "../components/night/DummyScreen";
import type { RoleScreenProps } from "../components/night/roleScreenTypes";
import WerewolfScreen from "../components/night/roles/WerewolfScreen";
import MinionScreen from "../components/night/roles/MinionScreen";
import MasonScreen from "../components/night/roles/MasonScreen";
import SeerScreen from "../components/night/roles/SeerScreen";
import RobberScreen from "../components/night/roles/RobberScreen";
import TroublemakerScreen from "../components/night/roles/TroublemakerScreen";
import DrunkScreen from "../components/night/roles/DrunkScreen";
import InsomniacScreen from "../components/night/roles/InsomniacScreen";
import DoppelgangerScreen from "../components/night/roles/DoppelgangerScreen";

const ROLE_SCREENS: Record<NightTickId, (props: RoleScreenProps<never>) => ReactElement> = {
  doppelganger: DoppelgangerScreen as never,
  werewolf: WerewolfScreen as never,
  minion: MinionScreen as never,
  mason: MasonScreen as never,
  seer: SeerScreen as never,
  robber: RobberScreen as never,
  troublemaker: TroublemakerScreen as never,
  drunk: DrunkScreen as never,
  insomniac: InsomniacScreen as never,
  doppelgangerInsomniac: InsomniacScreen as never,
};

function Night() {
  const { playerId, players, currentTick, nightPaused, nightEnded, actionResult, submitNightAction } = useRoomSocket();
  useFullscreen(!nightEnded);

  if (nightEnded) return <p>La nuit est terminée.</p>;
  if (nightPaused) return <p>La partie est en pause…</p>;
  if (!currentTick) return <p>En attente du début de la nuit…</p>;

  if (!currentTick.active) return <DummyScreen tickId={currentTick.tickId} />;

  const RoleScreen = ROLE_SCREENS[currentTick.tickId];
  const result = actionResult?.tickId === currentTick.tickId ? actionResult.result : null;

  return (
    <RoleScreen
      playerId={playerId}
      players={players}
      result={result as never}
      onSubmit={(params) => submitNightAction(currentTick.tickId, params)}
      onContinue={() => {}}
    />
  );
}

export default Night;
