import type { GameState, RoleId } from "@onuw/shared";
import { getCenterCard, getPlayer, replacePlayer, requireCurrentRole, swapCurrentRoles } from "./helpers.js";
import { actsAsOriginalOrDoppelgangerCopy, type NightTickId } from "../night/nightOrder.js";

export interface ActionResult<TResult = Record<string, never>> {
  gameState: GameState;
  result: TResult;
}

export type ActionResolver<TParams = Record<string, unknown>, TResult = unknown> = (
  actingPlayerId: string,
  gameState: GameState,
  params: TParams,
) => ActionResult<TResult>;

export const werewolfResolver: ActionResolver<
  { centerIndex?: number },
  { teammateIds: string[] } | { centerRoleId: RoleId }
> = (actingPlayerId, gameState, params) => {
  const teammateIds = gameState.players
    .filter((p) => actsAsOriginalOrDoppelgangerCopy("werewolf")(p, gameState) && p.id !== actingPlayerId)
    .map((p) => p.id);

  if (teammateIds.length === 0 && params.centerIndex !== undefined) {
    return { gameState, result: { centerRoleId: getCenterCard(gameState, params.centerIndex) } };
  }
  return { gameState, result: { teammateIds } };
};

export const minionResolver: ActionResolver<Record<string, never>, { werewolfIds: string[] }> = (
  _actingPlayerId,
  gameState,
) => {
  const werewolfIds = gameState.players
    .filter((p) => actsAsOriginalOrDoppelgangerCopy("werewolf")(p, gameState))
    .map((p) => p.id);
  return { gameState, result: { werewolfIds } };
};

export const masonResolver: ActionResolver<Record<string, never>, { masonIds: string[] }> = (
  actingPlayerId,
  gameState,
) => {
  const masonIds = gameState.players
    .filter((p) => actsAsOriginalOrDoppelgangerCopy("mason")(p, gameState) && p.id !== actingPlayerId)
    .map((p) => p.id);
  return { gameState, result: { masonIds } };
};

export type SeerParams =
  | { mode: "player"; targetPlayerId: string }
  | { mode: "center"; centerIndices: [number, number] };

export const seerResolver: ActionResolver<
  SeerParams,
  { roleId: RoleId } | { roleIds: [RoleId, RoleId] }
> = (_actingPlayerId, gameState, params) => {
  if (params.mode === "player") {
    const target = getPlayer(gameState, params.targetPlayerId);
    return { gameState, result: { roleId: requireCurrentRole(target) } };
  }
  const [a, b] = params.centerIndices;
  return { gameState, result: { roleIds: [getCenterCard(gameState, a), getCenterCard(gameState, b)] } };
};

export const insomniacResolver: ActionResolver<Record<string, never>, { roleId: RoleId }> = (
  actingPlayerId,
  gameState,
) => {
  const player = getPlayer(gameState, actingPlayerId);
  return { gameState, result: { roleId: requireCurrentRole(player) } };
};

export const robberResolver: ActionResolver<{ targetPlayerId: string }, { newRoleId: RoleId }> = (
  actingPlayerId,
  gameState,
  params,
) => {
  const swapped = swapCurrentRoles(gameState, actingPlayerId, params.targetPlayerId);
  const newRoleId = requireCurrentRole(getPlayer(swapped, actingPlayerId));
  return { gameState: swapped, result: { newRoleId } };
};

export const troublemakerResolver: ActionResolver<{ targetAId: string; targetBId: string }> = (
  _actingPlayerId,
  gameState,
  params,
) => {
  const swapped = swapCurrentRoles(gameState, params.targetAId, params.targetBId);
  return { gameState: swapped, result: {} };
};

export const drunkResolver: ActionResolver<{ centerIndex: number }> = (
  actingPlayerId,
  gameState,
  params,
) => {
  const drunkPlayer = getPlayer(gameState, actingPlayerId);
  const centerRole = getCenterCard(gameState, params.centerIndex);
  const nextCenter = gameState.center.map((role, i) =>
    i === params.centerIndex ? requireCurrentRole(drunkPlayer) : role,
  );
  const nextPlayers = gameState.players.map((p) =>
    p.id === actingPlayerId ? { ...p, currentRoleId: centerRole } : p,
  );
  return { gameState: { ...gameState, center: nextCenter, players: nextPlayers }, result: {} };
};

const IMMEDIATE_CHAIN_ROLES: RoleId[] = ["minion", "seer", "robber", "troublemaker", "drunk"];

export const doppelgangerResolver: ActionResolver<
  { targetPlayerId: string; subParams?: Record<string, unknown> },
  { copiedRoleId: RoleId; chained?: unknown }
> = (actingPlayerId, gameState, params) => {
  const target = getPlayer(gameState, params.targetPlayerId);
  const copiedRoleId = target.originalRoleId;
  if (!copiedRoleId) throw new Error(`doppelganger target ${params.targetPlayerId} has no assigned role`);

  if (!gameState.night) {
    throw new Error("doppelgangerResolver called outside an active night tick");
  }

  const nightUpdatedState: GameState = {
    ...gameState,
    night: {
      ...gameState.night,
      doppelgangerCopiedRoleId: copiedRoleId,
      doppelgangerCopiedPlayerId: actingPlayerId,
    },
  };

  if (IMMEDIATE_CHAIN_ROLES.includes(copiedRoleId)) {
    // Chain onto the copied role's own resolver with the Doppelganger's card still
    // physically labeled "doppelganger" (currentRoleId unchanged so far). This matters
    // for resolvers that move the acting player's own card (robber, drunk): the card
    // that ends up elsewhere is the real "doppelganger" card, not the copied role's name.
    const chainResolver = actionResolvers[copiedRoleId as keyof typeof actionResolvers] as ActionResolver<
      Record<string, unknown>,
      unknown
    >;
    const chainResult = chainResolver(actingPlayerId, nightUpdatedState, params.subParams ?? {});

    // Resolvers that never touch the acting player's own card (minion, seer, troublemaker)
    // leave currentRoleId at "doppelganger" — in that case the Doppelganger keeps their
    // card, now permanently labeled as the copied role, exactly like the non-chained case.
    let finalState = chainResult.gameState;
    if (getPlayer(finalState, actingPlayerId).currentRoleId === "doppelganger") {
      finalState = replacePlayer(finalState, actingPlayerId, { currentRoleId: copiedRoleId });
    }

    return { gameState: finalState, result: { copiedRoleId, chained: chainResult.result } };
  }

  const nextState = replacePlayer(nightUpdatedState, actingPlayerId, { currentRoleId: copiedRoleId });
  return { gameState: nextState, result: { copiedRoleId } };
};

export const doppelgangerInsomniacResolver: ActionResolver<Record<string, never>, { roleId: RoleId }> = (
  actingPlayerId,
  gameState,
) => {
  const player = getPlayer(gameState, actingPlayerId);
  return { gameState, result: { roleId: requireCurrentRole(player) } };
};

export const actionResolvers = {
  doppelganger: doppelgangerResolver,
  werewolf: werewolfResolver,
  minion: minionResolver,
  mason: masonResolver,
  seer: seerResolver,
  robber: robberResolver,
  troublemaker: troublemakerResolver,
  drunk: drunkResolver,
  insomniac: insomniacResolver,
  doppelgangerInsomniac: doppelgangerInsomniacResolver,
} satisfies Record<NightTickId, ActionResolver<never, unknown>>;
