import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import PlayerChoices from "../PlayerChoices";
import NightPrompt from "../../ui/NightPrompt";
import type { RoleScreenProps } from "../roleScreenTypes";

function RobberScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<{ newRoleId: RoleId }>) {
  if (result) {
    return (
      <RevealScreen
        label="Ta nouvelle carte"
        value={roleLabel(result.newRoleId)}
        note="Tu joues désormais ce rôle. La victime ignore l'échange."
        onContinue={onContinue}
      />
    );
  }

  return (
    <NightPrompt eyebrow="Voleur" title="Échange ta carte avec :">
      <PlayerChoices
        players={players}
        excludeId={playerId}
        onPick={(targetPlayerId) => onSubmit({ targetPlayerId })}
      />
    </NightPrompt>
  );
}

export default RobberScreen;
