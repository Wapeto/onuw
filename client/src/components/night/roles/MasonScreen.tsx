import { useEffect } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MasonScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<{ masonIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p>Les Francs-Maçons se reconnaissent…</p>;
  const names = result.masonIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  return (
    <RevealScreen onContinue={onContinue}>
      <p>{names ? `L'autre Franc-Maçon est : ${names}` : "Tu es le seul Franc-Maçon."}</p>
    </RevealScreen>
  );
}

export default MasonScreen;
