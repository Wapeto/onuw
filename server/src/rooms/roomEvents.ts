import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { generateRoomCode } from "./roomCode.js";
import { createRoom, getRoom, withRoom, RoomNotFoundError } from "./roomStore.js";
import { toPublicPlayers } from "./roomView.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const MAX_ROOM_CODE_ATTEMPTS = 5;

const pseudoSchema = z.string().trim().min(1).max(24);
const createRoomPayloadSchema = z.object({ pseudo: pseudoSchema });
const joinRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(1).max(10),
  pseudo: pseudoSchema,
});
const handshakeAuthSchema = z.object({ roomCode: z.string().min(1), playerId: z.string().min(1) }).partial();

async function broadcastRoster(io: AppServer, state: GameState): Promise<void> {
  io.to(state.roomCode).emit("PLAYER_LIST_UPDATE", { players: toPublicPlayers(state) });
}

async function setConnected(roomCode: string, playerId: string, connected: boolean): Promise<GameState | null> {
  try {
    return await withRoom(roomCode, (room) => ({
      ...room,
      players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
      updatedAt: Date.now(),
    }));
  } catch (err) {
    if (err instanceof RoomNotFoundError) return null;
    throw err;
  }
}

export function registerRoomEvents(io: AppServer, socket: AppSocket): void {
  let membership: { roomCode: string; playerId: string } | null = null;

  const authResult = handshakeAuthSchema.safeParse(socket.handshake.auth);
  const auth = authResult.success ? authResult.data : {};
  if (auth.roomCode && auth.playerId) {
    const roomCode = auth.roomCode;
    const playerId = auth.playerId;
    void (async () => {
      const state = await setConnected(roomCode, playerId, true);
      if (!state) return;
      membership = { roomCode, playerId };
      await socket.join(roomCode);
      await socket.join(playerId);
      socket.emit("ROOM_JOINED", { roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  }

  socket.on("CREATE_ROOM", (payload) => {
    void (async () => {
      const parsed = createRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "pseudo is required" });
        return;
      }
      const playerId = randomUUID();
      const now = Date.now();
      let state: GameState | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
        const roomCode = generateRoomCode();
        const candidate: GameState = {
          roomCode,
          phase: "LOBBY",
          players: [{ id: playerId, pseudo: parsed.data.pseudo, isHost: true, connected: true }],
          center: [],
          night: null,
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
      socket.emit("ROOM_CREATED", { roomCode: state.roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  });

  socket.on("JOIN_ROOM", (payload) => {
    void (async () => {
      const parsed = joinRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "pseudo and room code are required" });
        return;
      }
      const { roomCode, pseudo } = parsed.data;
      const existing = await getRoom(roomCode);
      if (!existing) {
        socket.emit("ROOM_ERROR", { message: "room not found" });
        return;
      }
      if (existing.phase !== "LOBBY") {
        socket.emit("ROOM_ERROR", { message: "game already in progress" });
        return;
      }
      const playerId = randomUUID();
      const state = await withRoom(roomCode, (room) => ({
        ...room,
        players: [...room.players, { id: playerId, pseudo, isHost: false, connected: true }],
        updatedAt: Date.now(),
      }));
      membership = { roomCode: state.roomCode, playerId };
      await socket.join(state.roomCode);
      await socket.join(playerId);
      socket.emit("ROOM_JOINED", { roomCode: state.roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  });

  socket.on("disconnect", () => {
    if (!membership) return;
    const { roomCode, playerId } = membership;
    void (async () => {
      const state = await setConnected(roomCode, playerId, false);
      if (state) await broadcastRoster(io, state);
    })();
  });
}
