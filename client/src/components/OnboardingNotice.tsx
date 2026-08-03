import { useState } from "react";

export interface OnboardingNoticeProps {
  onContinue: (dontShowAgain: boolean) => void;
}

function OnboardingNotice({ onContinue }: OnboardingNoticeProps) {
  // Checked by default: onuw-web-spec.md §5 asks for "shown once, not every
  // game once the group has already played" — since Reveal's "Rejouer" keeps
  // the same room and is explicitly designed for chaining rounds with zero
  // friction (§5 "Rejouer vite"), the default action (click Continuer
  // without touching the checkbox) must dismiss the notice for this room,
  // not require an opt-in click every time. Unchecking is the escape hatch
  // for a group that wants the reminder repeated anyway.
  const [dontShowAgain, setDontShowAgain] = useState(true);

  return (
    <div>
      <h1>Avant de commencer</h1>
      <p>Tête baissée, chacun regarde son propre écran.</p>
      <label>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Ne plus afficher pour cette partie
      </label>
      <button onClick={() => onContinue(dontShowAgain)}>Continuer</button>
    </div>
  );
}

export default OnboardingNotice;
