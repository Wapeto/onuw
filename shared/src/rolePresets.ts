import { ROLE_IDS } from "./types.js";
import type { GameMode, RoleCounts, RoleId } from "./types.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

// Sourced from the official Bezier Games rulebook for 3 and 5 players; 4 is the
// documented midpoint (base 3p + 1 Villager). 6-10 are this project's own
// extrapolation of the rulebook's stated philosophy ("add 1-2 roles at a time"),
// not official compositions — see docs/superpowers/plans/2026-07-28-onuw-web-app.md
// §Presets Classique. The 10-player row corrects an arithmetic error in that
// source doc: "replace 2 Villagers with Mason,Mason" nets 0 cards (12 -> 12),
// but 10 players need 13 — this replaces 1 Villager (not 2) to net +1 and land
// on 13 while still respecting the Mason-pair rule.
const CLASSIC_PRESETS: Record<number, RoleCounts> = {
  3: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
  4: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 },
  5: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 3 },
  6: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, villager: 3 },
  7: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, villager: 3 },
  8: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, villager: 3 },
  9: {
    werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, hunter: 1, villager: 3,
  },
  10: {
    werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, hunter: 1, mason: 2,
    villager: 2,
  },
};

export function buildClassicPreset(playerCount: number): RoleCounts {
  const preset = CLASSIC_PRESETS[playerCount];
  if (!preset) throw new Error(`no classic preset for ${playerCount} players`);
  return { ...preset };
}

export function buildSimplePreset(playerCount: number): RoleCounts {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`no simple preset for ${playerCount} players`);
  }
  return { werewolf: 2, villager: playerCount + 1 };
}

export function totalRoleCount(roles: RoleCounts): number {
  return Object.values(roles).reduce((sum: number, count) => sum + (count ?? 0), 0);
}

export function flattenRoleCounts(roles: RoleCounts): RoleId[] {
  const flat: RoleId[] = [];
  for (const id of ROLE_IDS) {
    const count = roles[id] ?? 0;
    for (let i = 0; i < count; i++) flat.push(id);
  }
  return flat;
}

const SINGLETON_ROLES: RoleId[] = [
  "doppelganger", "seer", "robber", "troublemaker", "drunk", "minion", "hunter", "tanner", "villageIdiot",
];
const CUSTOM_ONLY_ROLES: RoleId[] = ["doppelganger", "villageIdiot"];

export interface RoleSelectionValidation {
  valid: boolean;
  errors: string[];
}

export function validateRoleSelection(
  mode: GameMode,
  playerCount: number,
  roles: RoleCounts,
): RoleSelectionValidation {
  const errors: string[] = [];

  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    errors.push(`le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}`);
  }

  const total = totalRoleCount(roles);
  const target = playerCount + 3;
  if (total !== target) {
    errors.push(`le total de rôles doit être exactement ${target} (actuellement ${total})`);
  }

  const werewolfCount = roles.werewolf ?? 0;
  if (werewolfCount > 2) errors.push("au maximum 2 loups-garous");

  const masonCount = roles.mason ?? 0;
  if (masonCount !== 0 && masonCount !== 2) errors.push("les maçons vont toujours par paire (0 ou 2)");

  const insomniacCount = roles.insomniac ?? 0;
  if (insomniacCount > 0 && (roles.robber ?? 0) === 0 && (roles.troublemaker ?? 0) === 0) {
    errors.push("l'insomniaque nécessite le voleur ou la semeuse de troubles dans la partie");
  }

  for (const roleId of SINGLETON_ROLES) {
    if ((roles[roleId] ?? 0) > 1) errors.push(`${roleId} ne peut apparaître qu'une seule fois`);
  }

  if (mode !== "custom") {
    for (const roleId of CUSTOM_ONLY_ROLES) {
      if ((roles[roleId] ?? 0) > 0) errors.push(`${roleId} n'est disponible qu'en mode personnalisé`);
    }
  }

  for (const roleId of ROLE_IDS) {
    if ((roles[roleId] ?? 0) < 0) errors.push(`${roleId} ne peut pas avoir un nombre négatif de cartes`);
  }

  return { valid: errors.length === 0, errors };
}
