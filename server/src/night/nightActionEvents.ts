import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, NightTickId, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import { NIGHT_ORDER, nightOrderFor, type NightTick } from "./nightOrder.js";
import { actionResolvers } from "../roles/actionResolvers.js";
import { actionParamsSchemas } from "../roles/actionSchemas.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotInNightError extends Error {}
class StaleTickError extends Error {}
class NotActiveError extends Error {}
class AlreadyActedError extends Error {}
class InvalidSubActionError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotInNightError) return "aucune nuit en cours";
  if (err instanceof StaleTickError) return "ce tick est terminé";
  if (err instanceof NotActiveError) return "aucune action à faire ce tick";
  if (err instanceof AlreadyActedError) return "tu as déjà agi ce tour";
  if (err instanceof InvalidSubActionError) return "action de nuit invalide";
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
        // Must be the same filtered order the tick runner is walking, or
        // tickIndex would resolve to a different role here than the one the
        // client was actually shown.
        const tick = nightOrderFor(room, nightOrder)[room.night.tickIndex];
        if (!tick || tick.tickId !== payload.tickId) throw new StaleTickError();
        const player = room.players.find((p) => p.id === membership.playerId);
        if (!player || !tick.activeFor(player, room)) throw new NotActiveError();

        const playerRecord = room.night.resolvedActions?.[membership.playerId] ?? {};
        const isDoppelganger = payload.tickId === "doppelganger";
        const isPhase2 =
          isDoppelganger &&
          (parsedParams.data as { subParams?: Record<string, unknown> }).subParams !== undefined;
        const phaseKey = isPhase2 ? "phase2" : "phase1";
        if (playerRecord[phaseKey]) throw new AlreadyActedError();

        if (payload.tickId === "doppelganger") {
          const doppelgangerParams = parsedParams.data as {
            targetPlayerId: string;
            subParams?: Record<string, unknown>;
          };
          if (doppelgangerParams.subParams !== undefined) {
            const target = room.players.find((p) => p.id === doppelgangerParams.targetPlayerId);
            const copiedRoleId = target?.originalRoleId;
            if (copiedRoleId && Object.hasOwn(actionParamsSchemas, copiedRoleId)) {
              const subSchema = actionParamsSchemas[copiedRoleId as NightTickId];
              if (!subSchema.safeParse(doppelgangerParams.subParams).success) {
                throw new InvalidSubActionError();
              }
            }
          }
        }

        const resolver = actionResolvers[tick.tickId];
        const outcome = resolver(membership.playerId, room, parsedParams.data as never);
        result = outcome.result;

        if (!outcome.gameState.night) return outcome.gameState;
        return {
          ...outcome.gameState,
          night: {
            ...outcome.gameState.night,
            resolvedActions: {
              ...(outcome.gameState.night.resolvedActions ?? room.night.resolvedActions ?? {}),
              [membership.playerId]: { ...playerRecord, [phaseKey]: true },
            },
          },
        };
      });
      socket.emit("ACTION_RESULT", { tickId: payload.tickId, result });
    } catch (err) {
      socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
    }
  });
}
