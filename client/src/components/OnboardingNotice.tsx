import { useState } from "react";

export interface OnboardingNoticeProps {
  onContinue: (dontShowAgain: boolean) => void;
}

function OnboardingNotice({ onContinue }: OnboardingNoticeProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

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
