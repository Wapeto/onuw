import { useContext, type ReactNode } from "react";
import { ChainedRoleContext } from "../night/chainContext";

export interface NightPromptProps {
  /**
   * Small tracked-out kicker naming the role acting right now — a genuine
   * help for the player who has forgotten what they drew. Suppressed inside
   * a Doppelganger chain, where the copied role is already named above.
   */
  eyebrow?: string;
  /** The instruction itself. Kept as one text node so it reads as one line. */
  title: string;
  children?: ReactNode;
}

/**
 * The "you are awake, do your thing" layout: an instruction, then the
 * choices. Every night role uses it, so the wording is the only thing that
 * changes between roles and the composition never moves under the player's
 * thumb between ticks.
 */
function NightPrompt({ eyebrow, title, children }: NightPromptProps) {
  const chained = useContext(ChainedRoleContext);

  return (
    <div className="stack stagger">
      {eyebrow && !chained && <p className="eyebrow">{eyebrow}</p>}
      <p className="prompt">{title}</p>
      {children}
    </div>
  );
}

export default NightPrompt;
