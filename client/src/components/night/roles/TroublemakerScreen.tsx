import { useState } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function TroublemakerScreen({
  playerId,
  players,
  result,
  onSubmit,
  onContinue,
}: RoleScreenProps<Record<string, never>>) {
  const [firstPick, setFirstPick] = useState<string | null>(null);

  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Les deux cartes ont été échangées.</p>
      </RevealScreen>
    );
  }

  const candidates = players.filter((p) => p.id !== playerId);

  function pick(id: string) {
    if (!firstPick) {
      setFirstPick(id);
      return;
    }
    onSubmit({ targetAId: firstPick, targetBId: id });
  }

  return (
    <div>
      <p>Choisis deux joueurs dont tu vas échanger les cartes, sans les regarder :</p>
      {candidates
        .filter((p) => p.id !== firstPick)
        .map((p) => (
          <button key={p.id} onClick={() => pick(p.id)}>
            {p.pseudo}
          </button>
        ))}
    </div>
  );
}

export default TroublemakerScreen;
