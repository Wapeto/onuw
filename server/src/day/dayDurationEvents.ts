import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const setDayDurationSchema = z.object({
  durationMs: z.number().int().min(MIN_DAY_DURATION_MS).max(MAX_DAY_DURATION_MS),
});

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "durée de jour invalide";
}

export function broadcastDayDuration(io: AppServer, state: GameState): void {
  io.to(state.roomCode).emit("DAY_DURATION_UPDATE", { durationMs: state.dayDurationMs });
}

export function registerDayDurationEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("SET_DAY_DURATION", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = setDayDurationSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "durée de jour invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT") throw new WrongPhaseError();
          return { ...room, dayDurationMs: parsed.data.durationMs, updatedAt: Date.now() };
        });
        broadcastDayDuration(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
