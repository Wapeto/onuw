import type { PublicPlayer } from "@onuw/shared";
import Choice from "../ui/Choice";

export interface PlayerChoicesProps {
  players: PublicPlayer[];
  /** Usually the acting player — no night role may ever target itself. */
  excludeId?: string;
  /** Already-picked players, shown as selected and locked out. */
  pickedIds?: string[];
  onPick: (playerId: string) => void;
}

/**
 * "Pick someone at the table."
 *
 * The exclusion of self happens here rather than in each role screen, so a
 * new role can't accidentally ship a rule-breaking target list.
 */
function PlayerChoices({ players, excludeId, pickedIds = [], onPick }: PlayerChoicesProps) {
  const candidates = players.filter((p) => p.id !== excludeId);

  return (
    <div className="choices">
      {candidates.map((p, i) => (
        <Choice
          key={p.id}
          index={i}
          label={p.pseudo}
          pressed={pickedIds.includes(p.id)}
          disabled={pickedIds.includes(p.id)}
          onClick={() => onPick(p.id)}
        />
      ))}
    </div>
  );
}

export default PlayerChoices;
