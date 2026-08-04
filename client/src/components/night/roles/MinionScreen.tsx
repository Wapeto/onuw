import { useEffect } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MinionScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<{ werewolfIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p className="waiting">Le Sbire découvre les Loups…</p>;
  const names = result.werewolfIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  if (!names) {
    return (
      <RevealScreen
        tone="blood"
        label="Sbire"
        value="Il n'y a pas de Loup-Garou dans cette partie."
        onContinue={onContinue}
      />
    );
  }

  return (
    <RevealScreen
      tone="blood"
      label="Les Loups-Garous"
      value={names}
      // New players get the Minion backwards every single time, so the win
      // condition is stated on the card itself rather than left to the rules.
      note="Ils ignorent qui tu es. Tu gagnes avec eux, même si tu es éliminé."
      onContinue={onContinue}
    />
  );
}

export default MinionScreen;
