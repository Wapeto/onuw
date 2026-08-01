import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, NightTickId, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import { NIGHT_ORDER, type NightTick } from "./nightOrder.js";
import { actionResolvers } from "../roles/actionResolvers.js";
import { actionParamsSchemas } from "../roles/actionSchemas.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotInNightError extends Error {}
class StaleTickError extends Error {}
class NotActiveError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotInNightError) return "aucune nuit en cours";
  if (err instanceof StaleTickError) return "ce tick est terminé";
  if (err instanceof NotActiveError) return "aucune action à faire ce tick";
  return "action de nuit invalide";
}

export function registerNightActionEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
  nightOrder: NightTick[] = NIGHT_ORDER,
): void {
  socket.on("SUBMIT_NIGHT_ACTION", async (payload: { tickId: NightTickId; params: Record<string, unknown> }) => {
    const membership = getMembership();
    if (!membership) return;
    if (!Object.hasOwn(actionParamsSchemas, payload.tickId)) {
      socket.emit("ROOM_ERROR", { message: "action de nuit invalide" });
      return;
    }
    const schema = actionParamsSchemas[payload.tickId];
    const parsedParams = schema.safeParse(payload.params);
    if (!parsedParams.success) {
      socket.emit("ROOM_ERROR", { message: "action de nuit invalide" });
      return;
    }
    let result: unknown;
    try {
      await withRoom(membership.roomCode, (room) => {
        if (room.phase !== "NIGHT" || !room.night) throw new NotInNightError();
        const tick = nightOrder[room.night.tickIndex];
        if (tick.tickId !== payload.tickId) throw new StaleTickError();
        const player = room.players.find((p) => p.id === membership.playerId);
        if (!player || !tick.activeFor(player, room)) throw new NotActiveError();
        const resolver = actionResolvers[tick.tickId];
        const outcome = resolver(membership.playerId, room, parsedParams.data as never);
        result = outcome.result;
        return outcome.gameState;
      });
      socket.emit("ACTION_RESULT", { tickId: payload.tickId, result });
    } catch (err) {
      socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
    }
  });
}
