import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function RobberScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<{ newRoleId: RoleId }>) {
  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Ta nouvelle carte est : {roleLabel(result.newRoleId)}</p>
      </RevealScreen>
    );
  }

  return (
    <div>
      <p>Échange ta carte avec :</p>
      {players
        .filter((p) => p.id !== playerId)
        .map((p) => (
          <button key={p.id} onClick={() => onSubmit({ targetPlayerId: p.id })}>
            {p.pseudo}
          </button>
        ))}
    </div>
  );
}

export default RobberScreen;
