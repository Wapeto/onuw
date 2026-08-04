import { useEffect } from "react";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";
import type { RoleId } from "@onuw/shared";

function InsomniacScreen({ result, onSubmit, onContinue }: RoleScreenProps<{ roleId: RoleId }>) {
  useEffect(() => {
    onSubmit({});
  }, []);

  if (!result) return <p className="waiting">L'Insomniaque regarde sa carte…</p>;

  // Deliberately no note here: any extra line risks repeating the role name
  // and burying the one word this screen exists to deliver.
  return (
    <RevealScreen
      label="Ta carte, en fin de nuit"
      value={roleLabel(result.roleId)}
      onContinue={onContinue}
    />
  );
}

export default InsomniacScreen;
