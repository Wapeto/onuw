import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";

describe("role select events", () => {
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

  async function roomWithThreePlayers() {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });
    const guest1 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", () => resolve());
      guest1.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
    });
    const guest2 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", (p) => {
        if (p.players.length === 3) resolve();
      });
      guest2.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Carl" });
    });
    return { host, guest1, guest2, roomCode: created.roomCode };
  }

  it("defaults to the classic preset for the current player count on START_ROLE_SELECT", async () => {
    const { host, guest1, roomCode } = await roomWithThreePlayers();
    const guestUpdate = new Promise<{ mode: string; roles: Record<string, number>; valid: boolean }>((resolve) => {
      guest1.on("ROLE_SELECTION_UPDATE", resolve);
    });
    host.emit("START_ROLE_SELECT");
    const update = await guestUpdate;
    expect(update.mode).toBe("classic");
    expect(update.roles).toEqual({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 });
    expect(update.valid).toBe(true);
    expect(roomCode).toBeTruthy();
  });

  it("rejects START_ROLE_SELECT from a non-host", async () => {
    const { guest1 } = await roomWithThreePlayers();
    const err = new Promise<{ message: string }>((resolve) => guest1.on("ROOM_ERROR", resolve));
    guest1.emit("START_ROLE_SELECT");
    await expect(err).resolves.toMatchObject({ message: expect.any(String) });
  });

  it("switches to the simple preset (werewolves + villagers only) on SET_ROLE_MODE", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const update = new Promise<{ mode: string; roles: Record<string, number> }>((resolve) => {
      host.once("ROLE_SELECTION_UPDATE", resolve);
    });
    host.emit("SET_ROLE_MODE", { mode: "simple" });
    const result = await update;
    expect(result.mode).toBe("simple");
    expect(result.roles).toEqual({ werewolf: 2, villager: 4 });
  });

  it("applies a custom role selection via SET_CUSTOM_ROLES and reports validity", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_ROLE_MODE", { mode: "custom" });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const invalidUpdate = new Promise<{ valid: boolean }>((resolve) => host.once("ROLE_SELECTION_UPDATE", resolve));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, villager: 1 } });
    expect((await invalidUpdate).valid).toBe(false);

    const validUpdate = new Promise<{ valid: boolean }>((resolve) => host.once("ROLE_SELECTION_UPDATE", resolve));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } });
    expect((await validUpdate).valid).toBe(true);
  });

  // un-skipped in Task 5, once index.ts wires the real TickRunner
  it.skip("deals roles and starts the night sequence on START_GAME", async () => {
    const { host, roomCode } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const tickStart = new Promise<{ tickIndex: number }>((resolve) => host.once("TICK_START", resolve));
    host.emit("START_GAME");
    const tick = await tickStart;
    expect(tick.tickIndex).toBe(0);
    expect(roomCode).toBeTruthy();
  });

  it("rejects START_GAME while the selection is still invalid", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_ROLE_MODE", { mode: "custom" });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 1, villager: 1 } });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const err = new Promise<{ message: string }>((resolve) => host.once("ROOM_ERROR", resolve));
    host.emit("START_GAME");
    await expect(err).resolves.toMatchObject({ message: expect.any(String) });
  });

  it("catches up a reconnecting client with the current role selection", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const guest = await connect();
    const guestJoined = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>(
      (resolve) => {
        guest.on("ROOM_JOINED", resolve);
        guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
      },
    );

    const guest2 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", (p) => {
        if (p.players.length === 3) resolve();
      });
      guest2.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Carl" });
    });

    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    guest.close();
    await new Promise((r) => setTimeout(r, 200));

    const reattached = await connect({
      roomCode: guestJoined.roomCode,
      playerId: guestJoined.playerId,
      reconnectToken: guestJoined.reconnectToken,
    });
    const selectionOnReconnect = await new Promise<{ mode: string; roles: Record<string, number>; valid: boolean }>(
      (resolve) => reattached.on("ROLE_SELECTION_UPDATE", resolve),
    );

    expect(selectionOnReconnect.mode).toBe("classic");
    expect(selectionOnReconnect.valid).toBe(true);
  });
});
