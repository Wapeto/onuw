import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameMode, GameState, RoleCounts, ServerToClientEvents } from "@onuw/shared";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildClassicPreset,
  buildSimplePreset,
  isValidRoleId,
  validateRoleSelection,
} from "@onuw/shared";
import { withRoom } from "./roomStore.js";
import { transition } from "../state/phases.js";
import { assignRoles } from "../roles/presetValidation.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface Membership {
  roomCode: string;
  playerId: string;
}

export interface RoleSelectTickRunner {
  startNight: (roomCode: string) => Promise<void>;
}

const roleModeSchema = z.object({ mode: z.enum(["classic", "simple", "custom"]) });
// Plain string keys, not z.enum(ROLE_IDS): zod's record type inference over an
// enum key schema is exhaustive-by-construction (Record<RoleId, number>), which
// would reject the partial payloads every real SET_CUSTOM_ROLES call sends (a
// host only ever edits a handful of roles, not all 13). isValidRoleId is the
// same runtime guard `types.ts` already exports for exactly this purpose.
const roleCountsSchema = z
  .record(z.string(), z.number().int().min(0))
  .refine((roles) => Object.keys(roles).every((key) => isValidRoleId(key)), {
    message: "unknown role id in selection",
  });
const customRolesSchema = z.object({ roles: roleCountsSchema });

class NotHostError extends Error {}
class WrongPhaseError extends Error {}
class InvalidPlayerCountError extends Error {}
class InvalidSelectionError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  if (err instanceof InvalidPlayerCountError) {
    return `le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}`;
  }
  if (err instanceof InvalidSelectionError) return "la sélection de rôles actuelle n'est pas valide";
  return "une erreur est survenue";
}

export function broadcastRoleSelection(io: AppServer, state: GameState): void {
  if (!state.roleSelection) return;
  const { valid } = validateRoleSelection(state.roleSelection.mode, state.players.length, state.roleSelection.roles);
  io.to(state.roomCode).emit("ROLE_SELECTION_UPDATE", {
    mode: state.roleSelection.mode,
    roles: state.roleSelection.roles,
    valid,
  });
}

export function registerRoleSelectEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
  tickRunner: RoleSelectTickRunner,
): void {
  socket.on("START_ROLE_SELECT", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "LOBBY") throw new WrongPhaseError();
          if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
            throw new InvalidPlayerCountError();
          }
          const mode: GameMode = "classic";
          const roles = buildClassicPreset(room.players.length);
          return { ...transition(room, "ROLE_SELECT"), roleSelection: { mode, roles }, updatedAt: Date.now() };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("SET_ROLE_MODE", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = roleModeSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "mode invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT") throw new WrongPhaseError();
          const mode = parsed.data.mode;
          const roles: RoleCounts =
            mode === "classic"
              ? buildClassicPreset(room.players.length)
              : mode === "simple"
                ? buildSimplePreset(room.players.length)
                : { ...(room.roleSelection?.roles ?? {}) };
          return { ...room, roleSelection: { mode, roles }, updatedAt: Date.now() };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("SET_CUSTOM_ROLES", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = customRolesSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "sélection de rôles invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT" || room.roleSelection?.mode !== "custom") throw new WrongPhaseError();
          return {
            ...room,
            roleSelection: { mode: "custom" as const, roles: parsed.data.roles as RoleCounts },
            updatedAt: Date.now(),
          };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("START_GAME", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT" || !room.roleSelection) throw new WrongPhaseError();
          const { valid } = validateRoleSelection(
            room.roleSelection.mode,
            room.players.length,
            room.roleSelection.roles,
          );
          if (!valid) throw new InvalidSelectionError();
          return assignRoles(room);
        });
        await tickRunner.startNight(state.roomCode);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
