import { useState, type ReactElement } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import PlayerChoices from "../PlayerChoices";
import NightPrompt from "../../ui/NightPrompt";
import type { RoleScreenProps } from "../roleScreenTypes";
import { ChainedRoleContext } from "../chainContext";
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
      <NightPrompt eyebrow="Le Double" title="Choisis un joueur dont tu vas copier le rôle :">
        <PlayerChoices
          players={players}
          excludeId={playerId}
          pickedIds={targetPlayerId ? [targetPlayerId] : []}
          onPick={(id) => {
            setTargetPlayerId(id);
            onSubmit({ targetPlayerId: id });
          }}
        />
      </NightPrompt>
    );
  }

  const ChainScreen = CHAIN_SCREENS[result.copiedRoleId];
  if (ChainScreen) {
    // Two things happen in one tick here — you learn what you copied, then
    // you immediately play it. The banner keeps the copied role on screen
    // above the sub-action so the player never loses track of which role's
    // rules they're currently following.
    return (
      <div className="stack">
        <p className="copied">
          Tu as copié : {roleLabel(result.copiedRoleId)}.
          {!result.chained && " Fais son action :"}
        </p>
        <ChainedRoleContext.Provider value={true}>
          <ChainScreen
            playerId={playerId}
            players={players}
            result={(result.chained ?? null) as never}
            onSubmit={(subParams) => onSubmit({ targetPlayerId, subParams })}
            onContinue={onContinue}
          />
        </ChainedRoleContext.Provider>
      </div>
    );
  }

  return (
    <RevealScreen
      label="Tu as copié"
      value={roleLabel(result.copiedRoleId)}
      note="Tu joues ce rôle pour le reste de la partie, sans action cette nuit."
      onContinue={onContinue}
    />
  );
}

export default DoppelgangerScreen;
