import { useState } from "react";
import type { NightTickId } from "@onuw/shared";
import { DUMMY_CONFIG } from "./dummyConfig";

/**
 * What everyone who isn't acting sees during a tick.
 *
 * It must leak nothing: no countdown, no "waiting for 2 players", no hint
 * that this player has a reason to still be awake. A neighbour glancing
 * over must not be able to tell this screen apart from a real one — which
 * is why it's given the same weight and the same tap-to-confirm rhythm as
 * an actual role screen rather than looking like an idle state.
 */
function DummyScreen({ tickId }: { tickId: NightTickId }) {
  const [pressed, setPressed] = useState(false);
  const config = DUMMY_CONFIG[tickId];

  return (
    <div className="slumber stagger">
      <span className="unveil__sigil" aria-hidden="true" />
      <p className="slumber__prompt">{config.prompt}</p>
      {/* The button stays put once tapped rather than being swapped out:
          removing it would shift the layout under a thumb that's still on
          the glass, and a dimmed button is itself the confirmation. */}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => setPressed(true)}
        disabled={pressed}
      >
        {config.buttonLabel}
      </button>
      {pressed && <p className="slumber__zzz">Zzz…</p>}
    </div>
  );
}

export default DummyScreen;
