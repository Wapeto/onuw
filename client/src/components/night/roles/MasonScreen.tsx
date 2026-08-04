import { useEffect } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MasonScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<{ masonIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p className="waiting">Les Francs-Maçons se reconnaissent…</p>;
  const names = result.masonIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  if (!names) {
    return (
      <RevealScreen
        label="Franc-Maçon"
        value="Tu es le seul Franc-Maçon."
        // Seeing no partner is information, not a bug — the other Mason card
        // is in the centre. Players reliably assume the app failed otherwise.
        note="L'autre carte Franc-Maçon est au centre."
        onContinue={onContinue}
      />
    );
  }

  return (
    <RevealScreen
      label="L'autre Franc-Maçon"
      value={names}
      note="Vous êtes tous les deux du Village, sans le moindre doute."
      onContinue={onContinue}
    />
  );
}

export default MasonScreen;
