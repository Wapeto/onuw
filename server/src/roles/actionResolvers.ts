import type { GameState, RoleId } from "@onuw/shared";
import { getPlayer } from "./helpers.js";

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
    .filter((p) => p.currentRoleId === "werewolf" && p.id !== actingPlayerId)
    .map((p) => p.id);

  if (teammateIds.length === 0 && params.centerIndex !== undefined) {
    return { gameState, result: { centerRoleId: gameState.center[params.centerIndex] } };
  }
  return { gameState, result: { teammateIds } };
};

export const minionResolver: ActionResolver<Record<string, never>, { werewolfIds: string[] }> = (
  _actingPlayerId,
  gameState,
) => {
  const werewolfIds = gameState.players.filter((p) => p.currentRoleId === "werewolf").map((p) => p.id);
  return { gameState, result: { werewolfIds } };
};

export const masonResolver: ActionResolver<Record<string, never>, { masonIds: string[] }> = (
  actingPlayerId,
  gameState,
) => {
  const masonIds = gameState.players
    .filter((p) => p.currentRoleId === "mason" && p.id !== actingPlayerId)
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
    return { gameState, result: { roleId: target.currentRoleId! } };
  }
  const [a, b] = params.centerIndices;
  return { gameState, result: { roleIds: [gameState.center[a], gameState.center[b]] } };
};

export const insomniacResolver: ActionResolver<Record<string, never>, { roleId: RoleId }> = (
  actingPlayerId,
  gameState,
) => {
  const player = getPlayer(gameState, actingPlayerId);
  return { gameState, result: { roleId: player.currentRoleId! } };
};
