import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { getRoom, saveRoom } from "./roomStore.js";

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
});
