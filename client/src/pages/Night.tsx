import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { NightTickId } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useFullscreen } from "../hooks/useFullscreen";
import DreamScreen from "../components/night/DreamScreen";
import Slumber from "../components/night/Slumber";
import NightBar from "../components/night/NightBar";
import Screen from "../components/ui/Screen";
import Waiting from "../components/ui/Waiting";
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
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, currentTick, nightPaused, nightEnded, actionResult, submitNightAction, daySession } =
    useRoomSocket();
  useFullscreen(!nightEnded);

  // Whether this player is through with this tick — acted and acknowledged,
  // or dreamt to the end. Both land on the same idle screen, so a finished
  // tick tells a neighbour nothing about who was actually awake.
  const [done, setDone] = useState(false);
  const tickIndex = currentTick?.tickIndex ?? -1;
  useEffect(() => {
    setDone(false);
  }, [tickIndex]);

  useEffect(() => {
    if (daySession && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/day`);
    }
  }, [daySession, routeRoomCode, navigate]);

  if (nightEnded) return <Waiting phase="night">La nuit est terminée.</Waiting>;
  if (nightPaused) return <Waiting phase="night">La partie est en pause…</Waiting>;
  if (!currentTick) return <Waiting phase="night">En attente du début de la nuit…</Waiting>;

  const RoleScreen = ROLE_SCREENS[currentTick.tickId];
  const result = actionResult?.tickId === currentTick.tickId ? actionResult.result : null;

  // Both branches share one shell so the ground, the moon and the vertical
  // centring never shift between a tick where you act and a tick where you
  // don't — a visible layout change between the two would be a tell anyone
  // glancing across the table could read. The bar sits outside the branch
  // for the same reason: it is identical for everyone by construction.
  return (
    <Screen phase="night" align="center">
      <NightBar
        tickId={currentTick.tickId}
        tickNumber={currentTick.tickNumber}
        tickCount={currentTick.tickCount}
        durationMs={currentTick.durationMs}
        tickIndex={currentTick.tickIndex}
      />
      {done ? (
        <Slumber />
      ) : currentTick.active ? (
        <RoleScreen
          playerId={playerId}
          players={players}
          result={result as never}
          onSubmit={(params) => submitNightAction(currentTick.tickId, params)}
          onContinue={() => setDone(true)}
        />
      ) : (
        <DreamScreen
          tickId={currentTick.tickId}
          tickIndex={currentTick.tickIndex}
          playerId={playerId}
          players={players}
          onDone={() => setDone(true)}
        />
      )}
    </Screen>
  );
}

export default Night;
