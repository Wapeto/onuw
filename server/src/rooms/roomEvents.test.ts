import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";

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

  it("reattaches to an existing room via handshake auth", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const reattached = await connect({ roomCode: created.roomCode, playerId: created.playerId });
    const joined = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      reattached.on("ROOM_JOINED", resolve);
    });

    expect(joined).toEqual(created);
  });
});
