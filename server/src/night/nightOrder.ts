import type { GameState, Player, RoleId } from "@onuw/shared";

export type NightTickId =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "doppelgangerInsomniac";

export interface NightTick {
  tickId: NightTickId;
  baseDurationMs: number;
  activeFor: (player: Player, gameState: GameState) => boolean;
}

function actsAsOriginal(roleId: RoleId) {
  return (player: Player): boolean => player.originalRoleId === roleId;
}

export function actsAsOriginalOrDoppelgangerCopy(roleId: RoleId) {
  return (player: Player, gameState: GameState): boolean =>
    player.originalRoleId === roleId ||
    (player.originalRoleId === "doppelganger" && gameState.night?.doppelgangerCopiedRoleId === roleId);
}

export const NIGHT_ORDER: NightTick[] = [
  { tickId: "doppelganger", baseDurationMs: 8000, activeFor: actsAsOriginal("doppelganger") },
  { tickId: "werewolf", baseDurationMs: 7000, activeFor: actsAsOriginalOrDoppelgangerCopy("werewolf") },
  { tickId: "minion", baseDurationMs: 5000, activeFor: actsAsOriginal("minion") },
  { tickId: "mason", baseDurationMs: 5000, activeFor: actsAsOriginalOrDoppelgangerCopy("mason") },
  { tickId: "seer", baseDurationMs: 8000, activeFor: actsAsOriginal("seer") },
  { tickId: "robber", baseDurationMs: 8000, activeFor: actsAsOriginal("robber") },
  { tickId: "troublemaker", baseDurationMs: 7000, activeFor: actsAsOriginal("troublemaker") },
  { tickId: "drunk", baseDurationMs: 5000, activeFor: actsAsOriginal("drunk") },
  { tickId: "insomniac", baseDurationMs: 5000, activeFor: actsAsOriginal("insomniac") },
  {
    tickId: "doppelgangerInsomniac",
    baseDurationMs: 5000,
    activeFor: (player, gameState) =>
      player.originalRoleId === "doppelganger" &&
      gameState.night?.doppelgangerCopiedRoleId === "insomniac",
  },
];
