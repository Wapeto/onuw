import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { getRoom, saveRoom, createRoom } from "./roomStore.js";
import { registerRoomEvents } from "./roomEvents.js";
import { createDisconnectHandler } from "./disconnectHandler.js";

// Minimal fake `io`: only the two surfaces registerRoomEvents actually touches
// on the disconnect/reconnect path — `io.in(playerId).fetchSockets()` (checked
// to avoid flipping `connected` while another live socket for the player
// remains) and `io.to(roomCode).emit(...)` (broadcastRoster).
function fakeIoWithNoOtherSockets() {
  return {
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit: vi.fn() }),
  };
}

// Minimal fake socket carrying handshake auth for an already-known player, so
// registerRoomEvents' top-of-function reconnect-auth path attaches `membership`
// without going through a real socket.io-client connection. Mirrors the
// on/emit/trigger fake socket convention already used in
// night/nightActionEvents.test.ts.
function fakeSocketJoinedAs(playerId: string, roomCode: string, reconnectToken: string) {
  const handlers = new Map<string, (payload?: unknown) => void>();
  return {
    handshake: { auth: { roomCode, playerId, reconnectToken } },
    join: () => {},
    emit: vi.fn(),
    on: (event: string, cb: (payload?: unknown) => void) => handlers.set(event, cb),
    trigger: (event: string, payload?: unknown) => handlers.get(event)?.(payload),
  };
}

describe("room events", () => {
  let app: ReturnType<typeof createApp>;
  let port: number;
  const clients: Socket[] = [];

  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  beforeEach(async () => {
    app = createApp();
    port = await listen(app, 0);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  function connect(auth: Record<string, unknown> = {}): Promise<Socket> {
    return new Promise((resolve) => {
      const client = ioClient(`http://localhost:${port}`, { auth });
      clients.push(client);
      client.on("connect", () => resolve(client));
    });
  }

  it("creates a room and returns a roomCode/playerId", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });
    expect(created.roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
    expect(created.playerId).toBeTruthy();
  });

  it("rejects CREATE_ROOM with a blank pseudo", async () => {
    const host = await connect();
    const err = await new Promise<{ message: string }>((resolve) => {
      host.on("ROOM_ERROR", resolve);
      host.emit("CREATE_ROOM", { pseudo: "   " });
    });
    expect(err.message).toMatch(/pseudo/);
  });

  it("broadcasts an updated roster when a second player joins", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const rosterAfterJoin = new Promise<{ players: { pseudo: string }[] }>((resolve) => {
      host.on("PLAYER_LIST_UPDATE", (payload) => {
        if (payload.players.length === 2) resolve(payload);
      });
    });

    const guest = await connect();
    guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });

    const roster = await rosterAfterJoin;
    expect(roster.players.map((p) => p.pseudo).sort()).toEqual(["Alice", "Bob"]);
  });

  it("rejects JOIN_ROOM for an unknown room code", async () => {
    const guest = await connect();
    const err = await new Promise<{ message: string }>((resolve) => {
      guest.on("ROOM_ERROR", resolve);
      guest.emit("JOIN_ROOM", { roomCode: "ZZZZZ", pseudo: "Bob" });
    });
    expect(err.message).toMatch(/not found/);
  });

  it("marks a player disconnected in the broadcast roster", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const guest = await connect();
    await new Promise<void>((resolve) => {
      guest.on("ROOM_JOINED", () => resolve());
      guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
    });

    const disconnectedRoster = new Promise<{ players: { pseudo: string; connected: boolean | null }[] }>((resolve) => {
      host.on("PLAYER_LIST_UPDATE", (payload) => {
        const bob = payload.players.find((p) => p.pseudo === "Bob");
        if (bob && bob.connected === false) resolve(payload);
      });
    });
    guest.close();
    const roster = await disconnectedRoster;
    expect(roster.players.find((p) => p.pseudo === "Bob")?.connected).toBe(false);
  });

  it("keeps a player connected when a second socket for the same player is still joined", async () => {
    // Regresses the Home -> Lobby navigation race: the old page's socket disconnects
    // (and would normally mark the player disconnected) while a new page's socket for
    // the SAME player is already reconnected. The player must not flicker to
    // disconnected while any live socket for them remains.
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const secondSocketForHost = await connect({
      roomCode: created.roomCode,
      playerId: created.playerId,
      reconnectToken: created.reconnectToken,
    });
    await new Promise<void>((resolve) => {
      secondSocketForHost.on("ROOM_JOINED", () => resolve());
    });

    host.close();
    // Give the disconnect handler's fetchSockets()/setConnected() round-trip time to run
    // (and prove it does NOT flip connected to false) before asserting on stored state.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const state = await getRoom(created.roomCode);
    expect(state?.players.find((p) => p.id === created.playerId)?.connected).toBe(true);
  });

  it("reattaches to an existing room via handshake auth", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const reattached = await connect({
      roomCode: created.roomCode,
      playerId: created.playerId,
      reconnectToken: created.reconnectToken,
    });
    const joined = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>((resolve) => {
      reattached.on("ROOM_JOINED", resolve);
    });

    expect(joined).toEqual(created);
  });

  it("rejects JOIN_ROOM once the room has left LOBBY, without adding the player", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const inProgress = await getRoom(created.roomCode);
    await saveRoom({ ...inProgress!, phase: "ROLE_SELECT" });

    const guest = await connect();
    const err = await new Promise<{ message: string }>((resolve) => {
      guest.on("ROOM_ERROR", resolve);
      guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
    });
    expect(err.message).toMatch(/already in progress/);

    const state = await getRoom(created.roomCode);
    expect(state?.players.map((p) => p.pseudo)).toEqual(["Alice"]);
  });

  it("does not reattach when the handshake playerId does not belong to the room", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    let joined = false;
    const impostor = await connect({
      roomCode: created.roomCode,
      playerId: "not-a-real-player-id",
      reconnectToken: "not-a-real-token",
    });
    impostor.on("ROOM_JOINED", () => {
      joined = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(joined).toBe(false);
    const state = await getRoom(created.roomCode);
    expect(state?.players.map((p) => p.id)).toEqual([created.playerId]);
  });

  it("does not reattach when the handshake reconnectToken does not match the real player's token", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    let joined = false;
    const impostor = await connect({
      roomCode: created.roomCode,
      playerId: created.playerId,
      reconnectToken: "wrong-reconnect-token",
    });
    impostor.on("ROOM_JOINED", () => {
      joined = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(joined).toBe(false);
    const state = await getRoom(created.roomCode);
    expect(state?.players.find((p) => p.id === created.playerId)?.connected).toBe(true);
  });

  it("pauses the tick on disconnect during NIGHT and resumes it on reconnect", async () => {
    await createRoom({
      roomCode: "NGHT1",
      phase: "NIGHT",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "tok1" }],
      center: [],
      night: {
        tickIndex: 0,
        tickStartedAt: Date.now(),
        durationMs: 5000,
        paused: false,
        remainingMsAtPause: null,
        doppelgangerCopiedRoleId: null,
        doppelgangerCopiedPlayerId: null,
      },
      roleSelection: null,
      createdAt: 0,
      updatedAt: 0,
    });

    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const disconnectHandler = createDisconnectHandler({
      tickRunner: { pauseTick, resumeTick },
      scheduleGraceTimeout: vi.fn(),
    });
    const io = fakeIoWithNoOtherSockets();
    const socket = fakeSocketJoinedAs("p1", "NGHT1", "tok1");

    registerRoomEvents(io as never, socket as never, { startNight: vi.fn() }, disconnectHandler);

    // The handshake-auth reconnect path runs asynchronously (real Redis round
    // trip) before `membership` is attached; wait for its ROOM_JOINED emit
    // before triggering disconnect, otherwise the disconnect handler no-ops.
    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalledWith("ROOM_JOINED", expect.anything()));

    socket.trigger("disconnect");

    await vi.waitFor(() => expect(pauseTick).toHaveBeenCalledWith("NGHT1"));

    // Simulate the real reconnect: a fresh socket for the same player going
    // through the same handshake-auth path in registerRoomEvents. This is the
    // only way `disconnectHandler.handleReconnect` gets invoked with a pending
    // grace in play (the initial connection's handleReconnect call is a no-op,
    // since pendingGrace is empty before any disconnect has happened) — it's
    // what actually exercises the roomEvents.ts:102 call site added by this task.
    const reconnectedSocket = fakeSocketJoinedAs("p1", "NGHT1", "tok1");
    registerRoomEvents(io as never, reconnectedSocket as never, { startNight: vi.fn() }, disconnectHandler);

    await vi.waitFor(() => expect(resumeTick).toHaveBeenCalledWith("NGHT1"));
  });

  it("re-sends REVEAL_RESULT on reconnect when the room is already in REVEAL", async () => {
    await createRoom({
      roomCode: "RVL01",
      phase: "REVEAL",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "tok1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "tok2", originalRoleId: "villager", currentRoleId: "villager" },
      ],
      center: [],
      night: null,
      day: null,
      vote: null,
      reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2"], tally: { p1: 2 } },
      roleSelection: null,
      lastRoleSelection: null,
      dayDurationMs: 240_000,
      createdAt: 0,
      updatedAt: 0,
    });

    const disconnectHandler = createDisconnectHandler({
      tickRunner: { pauseTick: vi.fn(), resumeTick: vi.fn() },
    });
    const io = fakeIoWithNoOtherSockets();
    const socket = fakeSocketJoinedAs("p1", "RVL01", "tok1");

    registerRoomEvents(io as never, socket as never, { startNight: vi.fn() }, disconnectHandler);

    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalledWith("ROOM_JOINED", expect.anything()));

    expect(socket.emit).toHaveBeenCalledWith("REVEAL_RESULT", {
      eliminated: ["p1"],
      winningTeam: "village",
      winners: ["p2"],
      tally: { p1: 2 },
      players: [
        { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
      ],
    });
  });
});
