import { useState } from "react";

const MURMURS = [
  "Un mouton.",
  "Encore un.",
  "Le troupeau s'allonge.",
  "La barrière est loin.",
  "Ils sautent tous du même pied.",
  "Tu perds le compte.",
];

function murmurFor(count: number): string {
  if (count === 0) return "Ferme les yeux et compte.";
  return MURMURS[Math.min(count - 1, MURMURS.length - 1)];
}

/**
 * The idle beat between finishing your turn and the tick ending.
 *
 * Deliberately shown to *everyone* who is done — the player who just acted
 * and the player who just dreamt land on the identical screen — so the end
 * state of a tick reveals nothing about who did what. It also gives the
 * hands something to do: the first playtest's complaint was a phone that
 * went dead the instant you tapped once, for most of the night.
 */
function Slumber() {
  const [count, setCount] = useState(0);

  return (
    <div className="slumber stagger">
      <span className="unveil__sigil" aria-hidden="true" />
      <p className="slumber__prompt">{murmurFor(count)}</p>
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => setCount((c) => c + 1)}
      >
        Compter un mouton
      </button>
      {/* aria-live so the count is announced rather than silently changing
          under a screen reader's cursor. */}
      <p className="slumber__zzz" aria-live="polite">
        {count === 0 ? "Zzz…" : `${count} moutons`}
      </p>
    </div>
  );
}

export default Slumber;
