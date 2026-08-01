import { useEffect } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

type WerewolfResult = { teammateIds: string[] } | { centerRoleId: RoleId };

function WerewolfScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<WerewolfResult>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>Les Loups-Garous se regardent…</p>;

  if ("centerRoleId" in result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>La carte du centre est : {roleLabel(result.centerRoleId)}</p>
      </RevealScreen>
    );
  }

  if (result.teammateIds.length === 0) {
    return (
      <div>
        <p>Tu es seul, aucun autre Loup-Garou. Regarde une carte du centre :</p>
        {[0, 1, 2].map((index) => (
          <button key={index} onClick={() => onSubmit({ centerIndex: index })}>
            Carte {index + 1}
          </button>
        ))}
      </div>
    );
  }

  const names = result.teammateIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");
  return (
    <RevealScreen onContinue={onContinue}>
      <p>Les autres Loups-Garous sont : {names}</p>
    </RevealScreen>
  );
}

export default WerewolfScreen;
