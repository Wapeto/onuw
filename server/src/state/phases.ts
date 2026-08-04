import type { GameState, RoomPhase } from "@onuw/shared";

const ALLOWED_TRANSITIONS: Record<RoomPhase, RoomPhase[]> = {
  LOBBY: ["ROLE_SELECT"],
  ROLE_SELECT: ["ROLE_REVEAL", "LOBBY"],
  ROLE_REVEAL: ["NIGHT"],
  NIGHT: ["DAY"],
  DAY: ["VOTE"],
  VOTE: ["REVEAL"],
  REVEAL: ["ROLE_SELECT"],
};

export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transition(state: GameState, to: RoomPhase): GameState {
  if (!canTransition(state.phase, to)) {
    throw new Error(`invalid phase transition: ${state.phase} -> ${to}`);
  }
  return { ...state, phase: to, updatedAt: Date.now() };
}
