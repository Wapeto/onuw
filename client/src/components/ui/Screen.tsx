import type { ReactNode } from "react";

export type ScreenPhase = "lobby" | "night" | "day" | "vote" | "reveal";
export type ScreenTeam = "village" | "werewolf" | "tanner";

export interface ScreenProps {
  /** Drives the atmosphere: moon size/colour/position and the sky wash. */
  phase: ScreenPhase;
  /** Tints the reveal screen with the winning team's colour. */
  team?: ScreenTeam;
  /**
   * Night screens centre their single decision vertically so it lands under
   * the thumb; setup screens stay top-aligned so they read as documents.
   */
  align?: "top" | "center";
  children: ReactNode;
}

/**
 * The shell every page renders into.
 *
 * The atmosphere layer is a sibling of the content rather than a background
 * on it: the moon needs to bleed off the top of the viewport and the grain
 * needs to sit over the whole ground, neither of which a `background` on a
 * padded, max-width column can do.
 */
function Screen({ phase, team, align = "top", children }: ScreenProps) {
  return (
    <div className="screen" data-phase={phase} data-team={team} data-align={align}>
      <div className="atmos" aria-hidden="true">
        <div className="atmos__sky" />
        <div className="atmos__stars" />
        <div className="atmos__moon" />
        <div className="atmos__vignette" />
        <div className="atmos__grain" />
      </div>
      <div className="screen__inner">{children}</div>
    </div>
  );
}

export default Screen;
