import { useEffect } from "react";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";
import type { RoleId } from "@onuw/shared";

function InsomniacScreen({ result, onSubmit, onContinue }: RoleScreenProps<{ roleId: RoleId }>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>L'Insomniaque regarde sa carte…</p>;

  return (
    <RevealScreen onContinue={onContinue}>
      <p>Ta carte actuelle est : {roleLabel(result.roleId)}</p>
    </RevealScreen>
  );
}

export default InsomniacScreen;
