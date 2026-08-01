import { useState, type ReactElement } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";
import SeerScreen from "./SeerScreen";
import RobberScreen from "./RobberScreen";
import TroublemakerScreen from "./TroublemakerScreen";
import DrunkScreen from "./DrunkScreen";
import MinionScreen from "./MinionScreen";

type DoppelgangerResult = { copiedRoleId: RoleId; chained?: unknown };

const CHAIN_SCREENS: Partial<Record<RoleId, (props: RoleScreenProps<never>) => ReactElement>> = {
  minion: MinionScreen as never,
  seer: SeerScreen as never,
  robber: RobberScreen as never,
  troublemaker: TroublemakerScreen as never,
  drunk: DrunkScreen as never,
};

function DoppelgangerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<DoppelgangerResult>) {
  const [targetPlayerId, setTargetPlayerId] = useState<string | null>(null);

  if (!result) {
    return (
      <div>
        <p>Choisis un joueur dont tu vas copier le rôle :</p>
        {players
          .filter((p) => p.id !== playerId)
          .map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setTargetPlayerId(p.id);
                onSubmit({ targetPlayerId: p.id });
              }}
            >
              {p.pseudo}
            </button>
          ))}
      </div>
    );
  }

  const ChainScreen = CHAIN_SCREENS[result.copiedRoleId];
  if (ChainScreen) {
    return (
      <div>
        <p>
          Tu as copié : {roleLabel(result.copiedRoleId)}.
          {!result.chained && " Fais son action :"}
        </p>
        <ChainScreen
          playerId={playerId}
          players={players}
          result={(result.chained ?? null) as never}
          onSubmit={(subParams) => onSubmit({ targetPlayerId, subParams })}
          onContinue={onContinue}
        />
      </div>
    );
  }

  return (
    <RevealScreen onContinue={onContinue}>
      <p>Tu as copié : {roleLabel(result.copiedRoleId)}.</p>
    </RevealScreen>
  );
}

export default DoppelgangerScreen;
