import type { Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { getRoom } from "../rooms/roomStore.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface DayController {
  endDay: (roomCode: string, expectedStartedAt?: number) => Promise<void>;
}

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "impossible de passer au vote";
}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

/**
 * "We're done arguing, let's vote."
 *
 * The discussion timer used to be the only way out of the day, so a table
 * that had said everything it had to say sat watching a clock. The host can
 * now end it early; the pending timeout for this day is left to fire into a
 * room that has already moved on, where `endDay`'s own phase check discards
 * it.
 */
export function registerDayControlEvents(
  socket: AppSocket,
  getMembership: () => Membership | null,
  dayTimer: DayController,
): void {
  socket.on("SKIP_DAY", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const room = await getRoom(membership.roomCode);
        if (!room) throw new WrongPhaseError();
        requireHost(room, membership.playerId);
        if (room.phase !== "DAY" || !room.day) throw new WrongPhaseError();
        await dayTimer.endDay(membership.roomCode, room.day.startedAt);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
