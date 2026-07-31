import type { GameState, PublicPlayer } from "@onuw/shared";

export function toPublicPlayers(state: GameState): PublicPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    isHost: p.isHost,
    connected: state.phase === "NIGHT" ? null : p.connected,
  }));
}
