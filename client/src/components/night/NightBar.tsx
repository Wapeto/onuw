import { useEffect, useState, type CSSProperties } from "react";
import type { NightTickId } from "@onuw/shared";

/**
 * Who the night is calling right now.
 *
 * Naming the role out loud is what a human narrator does — "Voyante,
 * réveille-toi" is heard by the whole table — so showing it leaks nothing
 * and is the single clearest answer to "what is happening?".
 */
export const TICK_LABELS: Record<NightTickId, string> = {
  doppelganger: "Le Double",
  werewolf: "Les Loups-Garous",
  minion: "Le Sbire",
  mason: "Les Francs-Maçons",
  seer: "La Voyante",
  robber: "Le Voleur",
  troublemaker: "La Semeuse de troubles",
  drunk: "L'Ivrogne",
  insomniac: "L'Insomniaque",
  doppelgangerInsomniac: "Le Double s'éveille",
};

export interface NightBarProps {
  tickId: NightTickId;
  tickNumber: number;
  tickCount: number;
  durationMs: number;
  /** Re-arms the countdown; changes exactly once per tick. */
  tickIndex: number;
}

/**
 * The band pinned above every night screen — acting or sleeping, identical
 * in both cases by construction, since it renders outside the branch.
 *
 * The first playtest's "the night flies by, nobody knows what's happening"
 * was partly missing time: a tick began and ended with no indication that
 * it was one of five, or that it had eight seconds left. Position and
 * remaining time are public — a narrator's pace is audible to everyone — so
 * putting them on screen costs no secrecy.
 */
function NightBar({ tickId, tickNumber, tickCount, durationMs, tickIndex }: NightBarProps) {
  const [remainingMs, setRemainingMs] = useState(durationMs);

  useEffect(() => {
    setRemainingMs(durationMs);
    const startedAt = Date.now();
    // Wall-clock delta rather than a decrementing counter: a backgrounded
    // tab throttles intervals, and a drifting bar on a phone that was
    // briefly locked is worse than no bar at all.
    const interval = setInterval(() => {
      setRemainingMs(Math.max(durationMs - (Date.now() - startedAt), 0));
    }, 250);
    return () => clearInterval(interval);
  }, [durationMs, tickIndex]);

  const progress = durationMs > 0 ? remainingMs / durationMs : 0;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="nightbar">
      <div className="nightbar__row">
        <span className="nightbar__position">
          Nuit · {tickNumber}/{tickCount}
        </span>
        <span className="nightbar__role">{TICK_LABELS[tickId]}</span>
        <span className="nightbar__seconds" data-low={seconds <= 5}>
          {seconds}s
        </span>
      </div>
      <div className="nightbar__track">
        <div className="nightbar__fill" style={{ "--progress": progress } as CSSProperties} />
      </div>
    </div>
  );
}

export default NightBar;
