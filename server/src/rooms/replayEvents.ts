import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { validateRoleSelection } from "@onuw/shared";
import { withRoom } from "./roomStore.js";
import { transition } from "../state/phases.js";
import type { Membership } from "./roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut relancer une partie";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "impossible de relancer la partie";
}

export function registerReplayEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("REPLAY", async () => {
    const membership = getMembership();
    if (!membership) return;
    try {
      const state = await withRoom(membership.roomCode, (room) => {
        requireHost(room, membership.playerId);
        if (room.phase !== "REVEAL") throw new WrongPhaseError();

        const roleSelection = room.lastRoleSelection
          ? { mode: room.lastRoleSelection.mode, roles: { ...room.lastRoleSelection.roles } }
          : null;
        const players = room.players.map((p) => ({
          ...p,
          originalRoleId: undefined,
          currentRoleId: undefined,
        }));

        return {
          ...transition(room, "ROLE_SELECT"),
          players,
          center: [],
          night: null,
          day: null,
          vote: null,
          reveal: null,
          roleSelection,
          updatedAt: Date.now(),
        };
      });

      if (state.roleSelection) {
        const { valid } = validateRoleSelection(
          state.roleSelection.mode,
          state.players.length,
          state.roleSelection.roles,
        );
        io.to(state.roomCode).emit("ROLE_SELECTION_UPDATE", {
          mode: state.roleSelection.mode,
          roles: state.roleSelection.roles,
          valid,
        });
      }
    } catch (err) {
      socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
    }
  });
}
