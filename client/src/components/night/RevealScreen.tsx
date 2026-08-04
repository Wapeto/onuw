import { useState, type ReactNode } from "react";

export interface RevealScreenProps {
  /** Tracked-out kicker naming what's being shown, e.g. "Ta nouvelle carte". */
  label?: string;
  /** The payload itself — a role name, a list of names, one short line. */
  value?: ReactNode;
  /** Optional second line for context or consolation. */
  note?: ReactNode;
  /** `blood` for anything that puts the player on the werewolf side. */
  tone?: "moon" | "blood";
  children?: ReactNode;
  onContinue: () => void;
}

/**
 * The unveil — every secret a player learns at night lands here.
 *
 * This is the single most important surface in the app: it's read in about
 * half a second, on a phone tilted away from a neighbour, and it decides
 * how the rest of the game goes. Hence the deliberate hierarchy — a quiet
 * label, then the payload in display type, then everything else.
 */
function RevealScreen({ label, value, note, tone, children, onContinue }: RevealScreenProps) {
  const [pressed, setPressed] = useState(false);

  return (
    <div className="stack">
      <div className="unveil" data-tone={tone}>
        <span className="unveil__sigil" aria-hidden="true" />
        {label && <span className="unveil__label">{label}</span>}
        {value && <p className="unveil__value">{value}</p>}
        {note && <p className="unveil__note">{note}</p>}
        {children}
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => {
          setPressed(true);
          onContinue();
        }}
        disabled={pressed}
      >
        J'ai vu
      </button>
    </div>
  );
}

export default RevealScreen;
