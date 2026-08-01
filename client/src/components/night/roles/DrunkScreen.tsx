import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function DrunkScreen({ result, onSubmit, onContinue }: RoleScreenProps<Record<string, never>>) {
  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Ta carte a été échangée avec une carte du centre, sans que tu la voies.</p>
      </RevealScreen>
    );
  }

  return (
    <div>
      <p>Échange ta carte, sans la regarder, avec une carte du centre :</p>
      {[0, 1, 2].map((index) => (
        <button key={index} onClick={() => onSubmit({ centerIndex: index })}>
          Carte {index + 1}
        </button>
      ))}
    </div>
  );
}

export default DrunkScreen;
