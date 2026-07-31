import type { RoleId } from "@onuw/shared";

const ROLE_LABELS: Record<RoleId, string> = {
  doppelganger: "Le Double",
  werewolf: "Loup-Garou",
  minion: "Sbire",
  mason: "Franc-Maçon",
  seer: "Voyante",
  robber: "Voleur",
  troublemaker: "Semeuse de troubles",
  drunk: "Ivrogne",
  insomniac: "Insomniaque",
  villager: "Villageois",
  hunter: "Chasseur",
  tanner: "Tanneur",
  villageIdiot: "Idiot du Village",
};

export function roleLabel(roleId: RoleId): string {
  return ROLE_LABELS[roleId];
}
