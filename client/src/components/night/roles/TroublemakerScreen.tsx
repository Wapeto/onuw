import { useState } from "react";
import RevealScreen from "../RevealScreen";
import PlayerChoices from "../PlayerChoices";
import NightPrompt from "../../ui/NightPrompt";
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
      <RevealScreen
        label="Semeuse de troubles"
        value="Les deux cartes ont été échangées."
        note="Ni l'un ni l'autre ne le sait. Toi non plus, tu n'as rien vu."
        onContinue={onContinue}
      />
    );
  }

  function pick(id: string) {
    if (!firstPick) {
      setFirstPick(id);
      return;
    }
    onSubmit({ targetAId: firstPick, targetBId: id });
  }

  const firstName = players.find((p) => p.id === firstPick)?.pseudo;

  return (
    <NightPrompt
      eyebrow="Semeuse de troubles"
      title="Choisis deux joueurs dont tu vas échanger les cartes, sans les regarder :"
    >
      {/* The first pick stays visible and locked rather than vanishing from
          the grid: watching your own choice disappear reads as a bug, and
          the remaining names shifting under a thumb causes mis-taps. */}
      <PlayerChoices
        players={players}
        excludeId={playerId}
        pickedIds={firstPick ? [firstPick] : []}
        onPick={pick}
      />
      <p className="hint">
        {firstPick ? `${firstName} choisi · désigne le second` : "Désigne le premier joueur"}
      </p>
    </NightPrompt>
  );
}

export default TroublemakerScreen;
