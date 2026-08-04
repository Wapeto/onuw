import type { GameState, NightTickId, Player, RoleId } from "@onuw/shared";

export type { NightTickId } from "@onuw/shared";

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

// Durations are the narrator's pause for each role, and the first playtest
// found them far too short across the board: a Seer had to read the table,
// choose between a player and the centre, tap, then read the result — inside
// eight seconds. These are sized for an unhurried player doing the whole
// flow, since a long tick costs boredom while a short one costs a player
// their entire turn.
export const NIGHT_ORDER: NightTick[] = [
  { tickId: "doppelganger", baseDurationMs: 30000, activeFor: actsAsOriginal("doppelganger") },
  { tickId: "werewolf", baseDurationMs: 15000, activeFor: actsAsOriginalOrDoppelgangerCopy("werewolf") },
  { tickId: "minion", baseDurationMs: 12000, activeFor: actsAsOriginal("minion") },
  { tickId: "mason", baseDurationMs: 12000, activeFor: actsAsOriginalOrDoppelgangerCopy("mason") },
  { tickId: "seer", baseDurationMs: 25000, activeFor: actsAsOriginal("seer") },
  { tickId: "robber", baseDurationMs: 22000, activeFor: actsAsOriginal("robber") },
  { tickId: "troublemaker", baseDurationMs: 22000, activeFor: actsAsOriginal("troublemaker") },
  { tickId: "drunk", baseDurationMs: 15000, activeFor: actsAsOriginal("drunk") },
  { tickId: "insomniac", baseDurationMs: 12000, activeFor: actsAsOriginal("insomniac") },
  {
    tickId: "doppelgangerInsomniac",
    baseDurationMs: 12000,
    activeFor: (player, gameState) =>
      player.originalRoleId === "doppelganger" &&
      gameState.night?.doppelgangerCopiedRoleId === "insomniac",
  },
];

/**
 * Which cards must be somewhere in the deck for a tick to be called at all.
 *
 * The Doppelganger's second, Insomniac turn needs both cards: it can only
 * happen when a Doppelganger copies an Insomniac, which is impossible unless
 * both are in play.
 */
export const TICK_REQUIRED_ROLES: Record<NightTickId, RoleId[]> = {
  doppelganger: ["doppelganger"],
  werewolf: ["werewolf"],
  minion: ["minion"],
  mason: ["mason"],
  seer: ["seer"],
  robber: ["robber"],
  troublemaker: ["troublemaker"],
  drunk: ["drunk"],
  insomniac: ["insomniac"],
  doppelgangerInsomniac: ["doppelganger", "insomniac"],
};

/**
 * Every card dealt this game — the players' hands plus the three in the
 * centre. That is exactly the deck the host configured.
 *
 * Deliberately NOT "the roles the players are holding": if the Seer card sat
 * in the centre and the Seer were therefore never called, the whole table
 * would instantly know where it is. A centre role still gets its turn, and
 * everyone dutifully stares at a screen through it.
 */
export function rolesInPlay(gameState: GameState): Set<RoleId> {
  const roles = new Set<RoleId>(gameState.center);
  for (const player of gameState.players) {
    if (player.originalRoleId) roles.add(player.originalRoleId);
  }
  return roles;
}

/**
 * The night order for one specific game.
 *
 * Playtest bug: the runner walked the full ten-tick table every game, so a
 * three-player Classique (Werewolf/Seer/Robber/Troublemaker/Villager) still
 * summoned the Doppelganger, the Minion, the Masons, the Drunk and the
 * Insomniac — a long stretch of dead ticks for roles that weren't in the box,
 * and a table convinced the app was broken.
 */
export function nightOrderFor(gameState: GameState, order: NightTick[] = NIGHT_ORDER): NightTick[] {
  const inPlay = rolesInPlay(gameState);
  // Before the deal there is nothing to filter against, so callers in that
  // state (a room still in LOBBY, unit tests with bare fixtures) get the
  // full table unchanged rather than an empty night.
  if (inPlay.size === 0) return order;
  return order.filter((tick) => TICK_REQUIRED_ROLES[tick.tickId].every((roleId) => inPlay.has(roleId)));
}
