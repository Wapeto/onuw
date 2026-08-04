import { useState } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import CenterCards from "../CenterCards";
import PlayerChoices from "../PlayerChoices";
import NightPrompt from "../../ui/NightPrompt";
import type { RoleScreenProps } from "../roleScreenTypes";

type SeerResult = { roleId: RoleId } | { roleIds: [RoleId, RoleId] };

function SeerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<SeerResult>) {
  const [pickingCenter, setPickingCenter] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  if (result) {
    const text = "roleId" in result ? roleLabel(result.roleId) : result.roleIds.map(roleLabel).join(" et ");
    return (
      <RevealScreen label="Tu as vu" value={text} onContinue={onContinue} />
    );
  }

  if (pickingCenter) {
    function pick(index: number) {
      const next = selected.includes(index) ? selected : [...selected, index];
      setSelected(next);
      if (next.length === 2) onSubmit({ mode: "center", centerIndices: next });
    }
    return (
      <NightPrompt eyebrow="Voyante" title="Choisis 2 cartes du centre :">
        <CenterCards onPick={pick} picked={selected} />
        <p className="hint">
          {selected.length === 0 ? "Deux cartes à choisir" : "Encore une carte"}
        </p>
      </NightPrompt>
    );
  }

  return (
    <NightPrompt eyebrow="Voyante" title="Que veux-tu voir ?">
      <PlayerChoices
        players={players}
        excludeId={playerId}
        onPick={(targetPlayerId) => onSubmit({ mode: "player", targetPlayerId })}
      />
      {/* The centre option is a genuine fork, not a lesser one — two centre
          cards is often the stronger play — so it gets its own full-width
          button rather than hiding at the end of the player grid. */}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => setPickingCenter(true)}
      >
        Voir 2 cartes du centre
      </button>
    </NightPrompt>
  );
}

export default SeerScreen;
