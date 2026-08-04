import type { RoleCounts } from "@onuw/shared";
import { ROLE_IDS } from "@onuw/shared";
import { roleLabel } from "../roleLabels";

interface RoleRecapProps {
  roles: RoleCounts;
}

function RoleRecap({ roles }: RoleRecapProps) {
  const entries = ROLE_IDS.filter((id) => (roles[id] ?? 0) > 0);

  if (entries.length === 0) {
    return <p className="hint">Aucun rôle sélectionné</p>;
  }

  // Count and label stay in one text run so the chip reads as a single
  // phrase ("2 × Loup-Garou") rather than a number sitting next to a word.
  return (
    <ul className="chips">
      {entries.map((id) => (
        <li key={id} className="chip">
          {roles[id]} × {roleLabel(id)}
        </li>
      ))}
    </ul>
  );
}

export default RoleRecap;
