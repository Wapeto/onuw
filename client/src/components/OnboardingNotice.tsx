import { useState } from "react";
import Screen from "./ui/Screen";

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
    <Screen phase="night" align="center">
      <div className="stack stagger" style={{ textAlign: "center", alignItems: "center" }}>
        <span className="unveil__sigil" aria-hidden="true" />
        <p className="eyebrow">Avant de commencer</p>
        {/* The whole game's fairness rests on this one instruction, so it
            gets the largest type in the app outside the countdown. */}
        <h1 className="prompt" style={{ fontSize: "var(--step-4)" }}>
          Tête baissée, chacun regarde son propre écran.
        </h1>
        <p className="screen__lede" style={{ maxWidth: "30ch" }}>
          Personne ne parle et personne ne regarde le téléphone du voisin jusqu'au lever du jour.
        </p>
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        <label className="check">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          Ne plus afficher pour cette partie
        </label>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => onContinue(dontShowAgain)}
        >
          Continuer
        </button>
      </footer>
    </Screen>
  );
}

export default OnboardingNotice;
