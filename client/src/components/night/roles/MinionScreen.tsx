import { useEffect } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MinionScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<{ werewolfIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p>Le Sbire découvre les Loups…</p>;
  const names = result.werewolfIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  return (
    <RevealScreen onContinue={onContinue}>
      <p>{names ? `Les Loups-Garous sont : ${names}` : "Il n'y a pas de Loup-Garou dans cette partie."}</p>
    </RevealScreen>
  );
}

export default MinionScreen;
