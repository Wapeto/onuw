import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@onuw/shared";
import { attachRedisAdapter } from "./redis/socketAdapter.js";
import { registerRoomEvents } from "./rooms/roomEvents.js";
import { createTickRunner } from "./night/tickRunner.js";

export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: "*" } },
  );
  const subClient = attachRedisAdapter(io);

  // TICK_START/TICK_PAYLOAD/NIGHT_END aren't in ServerToClientEvents yet (Phase 4
  // adds that typed contract, per the Phase 1 final-review prerequisite) — the
  // TickRunner's own deps intentionally stay string-typed until then.
  const tickRunner = createTickRunner({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    emitToPlayer: (playerId, event, payload) => {
      (io.to(playerId) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
  });

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
    registerRoomEvents(io, socket, tickRunner);
  });

  return { httpServer, io, subClient };
}

export function listen(
  app: ReturnType<typeof createApp>,
  port: number,
): Promise<number> {
  return new Promise((resolve) => {
    app.httpServer.listen(port, () => {
      const address = app.httpServer.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      resolve(actualPort);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3001;
  listen(app, port).then((actualPort) => {
    console.log(`ONUW server listening on port ${actualPort}`);
  });
}
