import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@onuw/shared";
import { attachRedisAdapter } from "./redis/socketAdapter.js";
import { registerRoomEvents } from "./rooms/roomEvents.js";
import { createDisconnectHandler } from "./rooms/disconnectHandler.js";
import { createTickRunner } from "./night/tickRunner.js";
import { createDayTimer } from "./day/dayTimer.js";

export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: "*" } },
  );
  const subClient = attachRedisAdapter(io);

  // TICK_START/TICK_PAYLOAD/TICK_PAUSED/TICK_RESUMED/NIGHT_END are now typed on
  // ServerToClientEvents (Phase 4). TickRunnerDeps itself stays string-typed by
  // design — it's an event-name-agnostic runner — so the `unknown`-cast emit
  // wrappers below are unchanged.
  const dayTimer = createDayTimer({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
  });

  const tickRunner = createTickRunner({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    emitToPlayer: (playerId, event, payload) => {
      (io.to(playerId) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    onNightEnd: (roomCode) => dayTimer.startDay(roomCode),
  });

  const disconnectHandler = createDisconnectHandler({ tickRunner });

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
    registerRoomEvents(io, socket, tickRunner, disconnectHandler);
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
