import RevealScreen from "../RevealScreen";
import CenterCards from "../CenterCards";
import NightPrompt from "../../ui/NightPrompt";
import type { RoleScreenProps } from "../roleScreenTypes";

function DrunkScreen({ result, onSubmit, onContinue }: RoleScreenProps<Record<string, never>>) {
  if (result) {
    return (
      <RevealScreen
        label="Ivrogne"
        value="Ta carte a été échangée avec une carte du centre, sans que tu la voies."
        // Players ask "so what am I?" every time. The honest answer is the
        // point of the role, and saying it here stops the second-guessing.
        note="Tu ne sais plus quel rôle tu joues. C'est normal."
        onContinue={onContinue}
      />
    );
  }

  return (
    <NightPrompt eyebrow="Ivrogne" title="Échange ta carte, sans la regarder, avec une carte du centre :">
      <CenterCards onPick={(index) => onSubmit({ centerIndex: index })} />
    </NightPrompt>
  );
}

export default DrunkScreen;
