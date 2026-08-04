import Choice from "../ui/Choice";

export interface CenterCardsProps {
  onPick: (index: number) => void;
  /** Cards already chosen this turn — shown as selected and locked. */
  picked?: number[];
}

/**
 * The three face-down cards in the middle of the table.
 *
 * Shared by the lone Werewolf, the Seer and the Drunk so that "a card from
 * the centre" is always the same object in the same place, whatever role
 * you happen to be holding.
 */
function CenterCards({ onPick, picked = [] }: CenterCardsProps) {
  return (
    <div className="choices">
      {[0, 1, 2].map((index) => (
        <Choice
          key={index}
          index={index}
          label={`Carte ${index + 1}`}
          pressed={picked.includes(index)}
          disabled={picked.includes(index)}
          onClick={() => onPick(index)}
        />
      ))}
    </div>
  );
}

export default CenterCards;
