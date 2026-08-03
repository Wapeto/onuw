import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { validateRoleSelection, DEFAULT_DAY_DURATION_MS } from "@onuw/shared";
import { generateRoomCode } from "./roomCode.js";
import { createRoom, withRoom, RoomNotFoundError, getRoom } from "./roomStore.js";
import { toPublicPlayers, toRevealPlayers } from "./roomView.js";
import { registerRoleSelectEvents, type Membership, type RoleSelectTickRunner } from "./roleSelectEvents.js";
import { registerNightActionEvents } from "../night/nightActionEvents.js";
import { registerDayDurationEvents } from "../day/dayDurationEvents.js";
import { registerVoteEvents } from "../day/voteEvents.js";
import { registerReplayEvents } from "./replayEvents.js";
import { createDisconnectHandler } from "./disconnectHandler.js";
import { createRateLimiter } from "./rateLimiter.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const MAX_ROOM_CODE_ATTEMPTS = 5;

const pseudoSchema = z.string().trim().min(1).max(24);
const createRoomPayloadSchema = z.object({ pseudo: pseudoSchema });
const joinRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(1).max(10),
  pseudo: pseudoSchema,
});
const handshakeAuthSchema = z
  .object({ roomCode: z.string().min(1), playerId: z.string().min(1), reconnectToken: z.string().min(1) })
  .partial();

class RoomNotJoinableError extends Error {
  constructor(roomCode: string) {
    super(`room ${roomCode} is not joinable`);
    this.name = "RoomNotJoinableError";
  }
}

async function broadcastRoster(io: AppServer, state: GameState): Promise<void> {
  io.to(state.roomCode).emit("PLAYER_LIST_UPDATE", { players: toPublicPlayers(state) });
}

async function setConnected(
  roomCode: string,
  playerId: string,
  connected: boolean,
  reconnectToken?: string,
): Promise<GameState | null> {
  try {
    return await withRoom(roomCode, (room) => {
      // When a reconnectToken is supplied (the inbound, client-claimed reconnect path),
      // both id AND token must match the same player. The plain disconnect handler
      // omits the token since it's server-initiated, not client-claimed.
      const exists = room.players.some(
        (p) => p.id === playerId && (reconnectToken === undefined || p.reconnectToken === reconnectToken),
      );
      if (!exists) {
        // No such player in this room: treat identically to "room not found" so
        // callers can't use a guessed/stale playerId (or a correct id with a wrong
        // token) to attach to someone else's room.
        throw new RoomNotFoundError(roomCode);
      }
      return {
        ...room,
        players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
        updatedAt: Date.now(),
      };
    });
  } catch (err) {
    if (err instanceof RoomNotFoundError) return null;
    throw err;
  }
}

export function registerRoomEvents(
  io: AppServer,
  socket: AppSocket,
  tickRunner: RoleSelectTickRunner,
  disconnectHandler: ReturnType<typeof createDisconnectHandler>,
): void {
  let membership: Membership | null = null;

  // One bucket per connected socket, covering both mutating room-creation
  // events, so a spamming client can't flood Redis with ghost rooms or
  // hammer the withRoom CAS loop on JOIN_ROOM (Phase 2/7 final-review note).
  const mutationLimiter = createRateLimiter({ capacity: 5, refillMs: 3000 });

  const authResult = handshakeAuthSchema.safeParse(socket.handshake.auth);
  const auth = authResult.success ? authResult.data : {};
  if (auth.roomCode && auth.playerId && auth.reconnectToken) {
    const roomCode = auth.roomCode;
    const playerId = auth.playerId;
    const reconnectToken = auth.reconnectToken;
    void (async () => {
      try {
        const state = await setConnected(roomCode, playerId, true, reconnectToken);
        if (!state) return;
        membership = { roomCode, playerId };
        await socket.join(roomCode);
        await socket.join(playerId);
        socket.emit("ROOM_JOINED", { roomCode, playerId, reconnectToken });
        await broadcastRoster(io, state);
        socket.emit("DAY_DURATION_UPDATE", { durationMs: state.dayDurationMs });
        if (state.phase === "DAY" && state.day) {
          const elapsed = Date.now() - state.day.startedAt;
          const remainingMs = Math.max(state.day.durationMs - elapsed, 0);
          socket.emit("DAY_START", { durationMs: remainingMs });
        }
        if (state.phase === "VOTE") {
          socket.emit("VOTE_START", {});
        }
        if (state.phase === "REVEAL" && state.reveal) {
          socket.emit("REVEAL_RESULT", { ...state.reveal, players: toRevealPlayers(state) });
        }
        if (state.roleSelection) {
          const { valid } = validateRoleSelection(state.roleSelection.mode, state.players.length, state.roleSelection.roles);
          socket.emit("ROLE_SELECTION_UPDATE", {
            mode: state.roleSelection.mode,
            roles: state.roleSelection.roles,
            valid,
          });
        }
        await disconnectHandler.handleReconnect(roomCode, playerId);
      } catch {
        socket.emit("ROOM_ERROR", { message: "failed to reconnect to room" });
      }
    })();
  }

  socket.on("CREATE_ROOM", (payload) => {
    if (!mutationLimiter.tryConsume()) {
      socket.emit("ROOM_ERROR", { message: "too many requests, slow down" });
      return;
    }
    void (async () => {
      try {
        const parsed = createRoomPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          socket.emit("ROOM_ERROR", { message: "pseudo is required" });
          return;
        }
        const playerId = randomUUID();
        const reconnectToken = randomUUID();
        const now = Date.now();
        let state: GameState | null = null;
        for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
          const roomCode = generateRoomCode();
          const candidate: GameState = {
            roomCode,
            phase: "LOBBY",
            players: [
              { id: playerId, pseudo: parsed.data.pseudo, isHost: true, connected: true, reconnectToken },
            ],
            center: [],
            night: null,
            day: null,
            vote: null,
            reveal: null,
            roleSelection: null,
            lastRoleSelection: null,
            dayDurationMs: DEFAULT_DAY_DURATION_MS,
            createdAt: now,
            updatedAt: now,
          };
          if (await createRoom(candidate)) {
            state = candidate;
            break;
          }
        }
        if (!state) {
          socket.emit("ROOM_ERROR", { message: "failed to allocate a room code, try again" });
          return;
        }
        membership = { roomCode: state.roomCode, playerId };
        await socket.join(state.roomCode);
        await socket.join(playerId);
        socket.emit("ROOM_CREATED", { roomCode: state.roomCode, playerId, reconnectToken });
        await broadcastRoster(io, state);
      } catch {
        socket.emit("ROOM_ERROR", { message: "failed to create room" });
      }
    })();
  });

  socket.on("JOIN_ROOM", (payload) => {
    if (!mutationLimiter.tryConsume()) {
      socket.emit("ROOM_ERROR", { message: "too many requests, slow down" });
      return;
    }
    void (async () => {
      try {
        const parsed = joinRoomPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          socket.emit("ROOM_ERROR", { message: "pseudo and room code are required" });
          return;
        }
        const { roomCode, pseudo } = parsed.data;
        const playerId = randomUUID();
        const reconnectToken = randomUUID();
        let state: GameState;
        try {
          // Phase check + append happen in a single atomic mutate so a concurrent
          // phase transition (e.g. the host starting the game) can't slip a player
          // into a room that's no longer in LOBBY between a read and a write.
          state = await withRoom(roomCode, (room) => {
            if (room.phase !== "LOBBY") {
              throw new RoomNotJoinableError(roomCode);
            }
            return {
              ...room,
              players: [...room.players, { id: playerId, pseudo, isHost: false, connected: true, reconnectToken }],
              updatedAt: Date.now(),
            };
          });
        } catch (err) {
          if (err instanceof RoomNotFoundError) {
            socket.emit("ROOM_ERROR", { message: "room not found" });
            return;
          }
          if (err instanceof RoomNotJoinableError) {
            socket.emit("ROOM_ERROR", { message: "game already in progress" });
            return;
          }
          throw err;
        }
        membership = { roomCode: state.roomCode, playerId };
        await socket.join(state.roomCode);
        await socket.join(playerId);
        socket.emit("ROOM_JOINED", { roomCode: state.roomCode, playerId, reconnectToken });
        await broadcastRoster(io, state);
      } catch {
        socket.emit("ROOM_ERROR", { message: "failed to join room" });
      }
    })();
  });

  socket.on("disconnect", () => {
    if (!membership) return;
    const { roomCode, playerId } = membership;
    void (async () => {
      try {
        // Socket.io removes a disconnecting socket from all its rooms (including its
        // per-player room) before this handler runs, so if another live socket for the
        // same player is still joined (e.g. the brief overlap between an old page's
        // socket closing and a new page's socket reconnecting), fetchSockets() here
        // won't include the one that's disconnecting. Only mark the player disconnected
        // once no live socket remains for them, to avoid a stale-write race flipping
        // `connected` to false right after a newer connection already flipped it true.
        const remaining = await io.in(playerId).fetchSockets();
        if (remaining.length > 0) return;
        await disconnectHandler.handleDisconnect(roomCode, playerId);
        const state = await getRoom(roomCode);
        if (state) await broadcastRoster(io, state);
      } catch {
        socket.emit("ROOM_ERROR", { message: "failed to update connection status" });
      }
    })();
  });

  registerRoleSelectEvents(io, socket, () => membership, tickRunner);
  registerNightActionEvents(io, socket, () => membership);
  registerDayDurationEvents(io, socket, () => membership);
  registerVoteEvents(io, socket, () => membership);
  registerReplayEvents(io, socket, () => membership);
}
