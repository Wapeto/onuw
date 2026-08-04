import { useEffect, useState } from "react";
import type { NightTickId, PublicPlayer } from "@onuw/shared";
import RevealScreen from "./RevealScreen";
import PlayerChoices from "./PlayerChoices";
import CenterCards from "./CenterCards";
import NightPrompt from "../ui/NightPrompt";
import { DREAM_CONFIG, visionFor } from "./dreamConfig";

export interface DreamScreenProps {
  tickId: NightTickId;
  tickIndex: number;
  playerId: string;
  players: PublicPlayer[];
  /** Called once the dream has run its course, exactly like a real action. */
  onDone: () => void;
}

/**
 * What everyone who isn't acting sees during a tick.
 *
 * It must leak nothing: no "waiting for 2 players", no hint that this
 * player has any reason to be awake. A neighbour glancing over must not be
 * able to tell this screen apart from a real one — which is why it borrows
 * the real components (the same player grid, the same centre cards, the
 * same unveil) and asks for the same number of taps, rather than sitting
 * there as an idle state.
 *
 * Nothing tapped here is submitted, and no dream names a role, so the
 * player themselves is never misled about the game.
 */
function DreamScreen({ tickId, tickIndex, playerId, players, onDone }: DreamScreenProps) {
  const config = DREAM_CONFIG[tickId];
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedCards, setPickedCards] = useState<number[]>([]);
  const [lookingAtCenter, setLookingAtCenter] = useState(false);
  const [finished, setFinished] = useState(false);

  const step = config.steps[0];
  const settled = finished || step.kind === "wait";

  // A real action waits on the server before its unveil appears. Without the
  // same beat, a sleeping player's screen would resolve instantly while the
  // acting player's still said "…", which is a difference in rhythm anyone
  // watching the table could learn to read.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setRevealed(true), 700);
    return () => clearTimeout(timer);
  }, [settled]);

  if (settled) {
    if (!revealed) {
      return <p className="waiting">{step.kind === "wait" ? step.text : "…"}</p>;
    }
    // The "wait" ticks mirror roles that act without choosing — the wolves
    // recognising each other, the Insomniac checking their own card.
    return (
      <RevealScreen
        label="Tu as rêvé"
        value={visionFor(tickId, tickIndex + playerId.length)}
        onContinue={onDone}
      />
    );
  }

  function finishAfter(count: number, total: number) {
    if (count >= total) setFinished(true);
  }

  if (step.kind === "playersOrCenter") {
    if (lookingAtCenter) {
      return (
        <NightPrompt title="Deux cartes te regardent :">
          <CenterCards
            picked={pickedCards}
            onPick={(index) => {
              const next = pickedCards.includes(index) ? pickedCards : [...pickedCards, index];
              setPickedCards(next);
              finishAfter(next.length, 2);
            }}
          />
          <p className="hint">{pickedCards.length === 0 ? "Deux cartes à choisir" : "Encore une carte"}</p>
        </NightPrompt>
      );
    }
    return (
      <NightPrompt title={step.prompt}>
        <PlayerChoices players={players} excludeId={playerId} onPick={() => setFinished(true)} />
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => setLookingAtCenter(true)}
        >
          {step.centerLabel}
        </button>
      </NightPrompt>
    );
  }

  if (step.kind === "center") {
    return (
      <NightPrompt title={step.prompt}>
        <CenterCards
          picked={pickedCards}
          onPick={(index) => {
            const next = [...pickedCards, index];
            setPickedCards(next);
            finishAfter(next.length, step.picks);
          }}
        />
        <p className="hint">{step.hints[pickedCards.length] ?? step.hints[step.hints.length - 1]}</p>
      </NightPrompt>
    );
  }

  return (
    <NightPrompt title={step.prompt}>
      <PlayerChoices
        players={players}
        excludeId={playerId}
        pickedIds={picked}
        onPick={(id) => {
          const next = [...picked, id];
          setPicked(next);
          finishAfter(next.length, step.picks);
        }}
      />
      <p className="hint">{step.hints[picked.length] ?? step.hints[step.hints.length - 1]}</p>
    </NightPrompt>
  );
}

export default DreamScreen;
