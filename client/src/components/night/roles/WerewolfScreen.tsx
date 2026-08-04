import { useEffect } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import CenterCards from "../CenterCards";
import NightPrompt from "../../ui/NightPrompt";
import type { RoleScreenProps } from "../roleScreenTypes";

type WerewolfResult = { teammateIds: string[] } | { centerRoleId: RoleId };

function WerewolfScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<WerewolfResult>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p className="waiting">Les Loups-Garous se regardent…</p>;

  if ("centerRoleId" in result) {
    return (
      <RevealScreen
        tone="blood"
        label="La carte du centre"
        value={roleLabel(result.centerRoleId)}
        note="Personne d'autre ne l'a vue."
        onContinue={onContinue}
      />
    );
  }

  // Lone wolf: the rules let you peek at one centre card as compensation.
  if (result.teammateIds.length === 0) {
    return (
      <NightPrompt
        eyebrow="Loup-Garou"
        title="Tu es seul, aucun autre Loup-Garou. Regarde une carte du centre :"
      >
        <CenterCards onPick={(index) => onSubmit({ centerIndex: index })} />
      </NightPrompt>
    );
  }

  const names = result.teammateIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");
  return (
    <RevealScreen
      tone="blood"
      label="Les autres Loups-Garous"
      value={names}
      note="Vous gagnez ensemble si aucun de vous n'est éliminé."
      onContinue={onContinue}
    />
  );
}

export default WerewolfScreen;
