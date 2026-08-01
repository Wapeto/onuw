import { useState } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

type SeerResult = { roleId: RoleId } | { roleIds: [RoleId, RoleId] };

function SeerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<SeerResult>) {
  const [pickingCenter, setPickingCenter] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  if (result) {
    const text = "roleId" in result ? roleLabel(result.roleId) : result.roleIds.map(roleLabel).join(" et ");
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Tu as vu : {text}</p>
      </RevealScreen>
    );
  }

  if (pickingCenter) {
    function pick(index: number) {
      const next = selected.includes(index) ? selected : [...selected, index];
      setSelected(next);
      if (next.length === 2) onSubmit({ mode: "center", centerIndices: next });
    }
    return (
      <div>
        <p>Choisis 2 cartes du centre :</p>
        {[0, 1, 2].map((index) => (
          <button key={index} onClick={() => pick(index)} disabled={selected.includes(index)}>
            Carte {index + 1}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <p>Que veux-tu voir ?</p>
      {players
        .filter((p) => p.id !== playerId)
        .map((p) => (
          <button key={p.id} onClick={() => onSubmit({ mode: "player", targetPlayerId: p.id })}>
            {p.pseudo}
          </button>
        ))}
      <button onClick={() => setPickingCenter(true)}>Voir 2 cartes du centre</button>
    </div>
  );
}

export default SeerScreen;
