import type { CSSProperties } from "react";

export interface ChoiceProps {
  /** Label — this is also the button's accessible name, verbatim. */
  label: string;
  onClick: () => void;
  /**
   * Position in the list. Only drives the decorative moon-phase avatar, so
   * a grid of names reads as a row of different tokens rather than
   * repeating discs.
   */
  index?: number;
  pressed?: boolean;
  disabled?: boolean;
}

/**
 * The tap target for every "pick a player / pick a card" moment.
 *
 * Kept as a bare label with no extra text nodes on purpose: the avatar is a
 * CSS pseudo-element, so a screen reader announces exactly the pseudo —
 * "Bob", not "B Bob".
 */
function Choice({ label, onClick, index = 0, pressed, disabled }: ChoiceProps) {
  return (
    <button
      type="button"
      className="btn choice"
      style={{ "--i": index } as CSSProperties}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default Choice;
