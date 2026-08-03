import type { GameState, PublicPlayer, RevealPlayer } from "@onuw/shared";
import { requireCurrentRole, requireOriginalRole } from "../roles/helpers.js";

export function toPublicPlayers(state: GameState): PublicPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    isHost: p.isHost,
    connected: state.phase === "NIGHT" ? null : p.connected,
  }));
}

export function toRevealPlayers(state: GameState): RevealPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    originalRoleId: requireOriginalRole(p),
    currentRoleId: requireCurrentRole(p),
  }));
}
