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

function excludeDoppelganger(roleId: RoleId) {
  return (player: Player): boolean =>
    player.currentRoleId === roleId && player.originalRoleId !== "doppelganger";
}

function includeGenerically(roleId: RoleId) {
  return (player: Player): boolean => player.currentRoleId === roleId;
}

export const NIGHT_ORDER: NightTick[] = [
  { tickId: "doppelganger", baseDurationMs: 8000, activeFor: includeGenerically("doppelganger") },
  { tickId: "werewolf", baseDurationMs: 7000, activeFor: includeGenerically("werewolf") },
  { tickId: "minion", baseDurationMs: 5000, activeFor: excludeDoppelganger("minion") },
  { tickId: "mason", baseDurationMs: 5000, activeFor: includeGenerically("mason") },
  { tickId: "seer", baseDurationMs: 8000, activeFor: excludeDoppelganger("seer") },
  { tickId: "robber", baseDurationMs: 8000, activeFor: excludeDoppelganger("robber") },
  { tickId: "troublemaker", baseDurationMs: 7000, activeFor: excludeDoppelganger("troublemaker") },
  { tickId: "drunk", baseDurationMs: 5000, activeFor: excludeDoppelganger("drunk") },
  { tickId: "insomniac", baseDurationMs: 5000, activeFor: excludeDoppelganger("insomniac") },
  {
    tickId: "doppelgangerInsomniac",
    baseDurationMs: 5000,
    activeFor: (player, gameState) =>
      player.originalRoleId === "doppelganger" &&
      gameState.night?.doppelgangerCopiedRoleId === "insomniac",
  },
];
