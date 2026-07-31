import type { RoleCounts } from "@onuw/shared";
import { ROLE_IDS } from "@onuw/shared";
import { roleLabel } from "../roleLabels";

interface RoleRecapProps {
  roles: RoleCounts;
}

function RoleRecap({ roles }: RoleRecapProps) {
  const entries = ROLE_IDS.filter((id) => (roles[id] ?? 0) > 0);

  if (entries.length === 0) {
    return <p>Aucun rôle sélectionné</p>;
  }

  return (
    <ul>
      {entries.map((id) => (
        <li key={id}>
          {roles[id]} × {roleLabel(id)}
        </li>
      ))}
    </ul>
  );
}

export default RoleRecap;
