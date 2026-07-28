import type { GameState, Player } from "@onuw/shared";

export function getPlayer(gameState: GameState, playerId: string): Player {
  const found = gameState.players.find((p) => p.id === playerId);
  if (!found) throw new Error(`player ${playerId} not found in room ${gameState.roomCode}`);
  return found;
}

export function replacePlayer(
  gameState: GameState,
  playerId: string,
  patch: Partial<Player>,
): GameState {
  return {
    ...gameState,
    players: gameState.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)),
  };
}

export function swapCurrentRoles(gameState: GameState, playerAId: string, playerBId: string): GameState {
  const a = getPlayer(gameState, playerAId);
  const b = getPlayer(gameState, playerBId);
  return {
    ...gameState,
    players: gameState.players.map((p) => {
      if (p.id === playerAId) return { ...p, currentRoleId: b.currentRoleId };
      if (p.id === playerBId) return { ...p, currentRoleId: a.currentRoleId };
      return p;
    }),
  };
}
