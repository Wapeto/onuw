import type { ScreenPhase } from "./Screen";
import Screen from "./Screen";

export interface WaitingProps {
  phase: ScreenPhase;
  /** Kept to a single sentence — these states last seconds, not minutes. */
  children: string;
}

/**
 * The "en attente…" / "chargement…" beat.
 *
 * There are seven of these across the app and they are the states players
 * see most often between ticks, so they get a real composition rather than
 * a bare paragraph: full-bleed atmosphere, centred line, breathing dots.
 */
function Waiting({ phase, children }: WaitingProps) {
  return (
    <Screen phase={phase} align="center">
      <p className="waiting">{children}</p>
    </Screen>
  );
}

export default Waiting;
