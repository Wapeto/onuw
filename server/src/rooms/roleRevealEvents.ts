import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, RoleCounts, RoleId, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "./roomStore.js";
import { NIGHT_ORDER, TICK_REQUIRED_ROLES } from "../night/nightOrder.js";
import type { Membership, RoleSelectTickRunner } from "./roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "une erreur est survenue";
}

/** Roles that are called during the night, derived from the night order itself. */
const WAKING_ROLES: ReadonlySet<RoleId> = new Set(
  NIGHT_ORDER.flatMap((tick) => TICK_REQUIRED_ROLES[tick.tickId]),
);

export function wakesAtNight(roleId: RoleId): boolean {
  return WAKING_ROLES.has(roleId);
}

/** The full deck as counts — players' hands plus the centre. */
export function deckCounts(state: GameState): RoleCounts {
  const counts: RoleCounts = {};
  const dealt: RoleId[] = [
    ...state.players.flatMap((p) => (p.originalRoleId ? [p.originalRoleId] : [])),
    ...state.center,
  ];
  for (const roleId of dealt) {
    counts[roleId] = (counts[roleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Deal each player their own card, on their own socket only.
 *
 * Until this existed, `originalRoleId` was written at deal time and then
 * never shown to anyone before the final reveal: players went into the night
 * genuinely not knowing what they were holding.
 */
export function emitRoleCards(io: AppServer, state: GameState): void {
  const rolesInPlay = deckCounts(state);
  for (const player of state.players) {
    if (!player.originalRoleId) continue;
    io.to(player.id).emit("YOUR_ROLE", {
      roleId: player.originalRoleId,
      rolesInPlay,
      wakesAtNight: wakesAtNight(player.originalRoleId),
    });
  }
}

export function broadcastRoleReveal(io: AppServer, state: GameState): void {
  io.to(state.roomCode).emit("ROLE_REVEAL_UPDATE", {
    readyPlayerIds: state.roleReveal?.readyPlayerIds ?? [],
    totalPlayers: state.players.length,
  });
}

/**
 * Everyone still connected has read their card.
 *
 * Connected-only so one player closing their tab can't hold the table
 * hostage; the host's manual START_NIGHT covers the rest.
 */
function everyoneReady(state: GameState): boolean {
  const ready = new Set(state.roleReveal?.readyPlayerIds ?? []);
  const waitingOn = state.players.filter((p) => p.connected);
  return waitingOn.length > 0 && waitingOn.every((p) => ready.has(p.id));
}

export function registerRoleRevealEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
  tickRunner: RoleSelectTickRunner,
): void {
  socket.on("READY_FOR_NIGHT", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          if (room.phase !== "ROLE_REVEAL") throw new WrongPhaseError();
          const readyPlayerIds = room.roleReveal?.readyPlayerIds ?? [];
          if (readyPlayerIds.includes(membership.playerId)) return room;
          return {
            ...room,
            roleReveal: { readyPlayerIds: [...readyPlayerIds, membership.playerId] },
            updatedAt: Date.now(),
          };
        });
        broadcastRoleReveal(io, state);
        if (everyoneReady(state)) {
          await tickRunner.startNight(state.roomCode);
        }
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("START_NIGHT", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          const player = room.players.find((p) => p.id === membership.playerId);
          if (!player?.isHost) throw new NotHostError();
          if (room.phase !== "ROLE_REVEAL") throw new WrongPhaseError();
          return room;
        });
        await tickRunner.startNight(state.roomCode);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
