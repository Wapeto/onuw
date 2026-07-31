import type { GameState } from "@onuw/shared";
import { flattenRoleCounts, validateRoleSelection } from "@onuw/shared";

export function isRoleSelectionValid(gameState: GameState): boolean {
  if (!gameState.roleSelection) return false;
  const { mode, roles } = gameState.roleSelection;
  return validateRoleSelection(mode, gameState.players.length, roles).valid;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

export function assignRoles(gameState: GameState, random: () => number = Math.random): GameState {
  if (!isRoleSelectionValid(gameState)) {
    throw new Error(`cannot assign roles: current selection is invalid for room ${gameState.roomCode}`);
  }
  const deck = shuffle(flattenRoleCounts(gameState.roleSelection!.roles), random);
  const playerCount = gameState.players.length;
  const dealtToPlayers = deck.slice(0, playerCount);
  const dealtToCenter = deck.slice(playerCount);

  const players = gameState.players.map((player, index) => ({
    ...player,
    originalRoleId: dealtToPlayers[index],
    currentRoleId: dealtToPlayers[index],
  }));

  return { ...gameState, players, center: dealtToCenter, roleSelection: null, updatedAt: Date.now() };
}
