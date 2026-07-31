import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom, deleteRoom, withRoom, RoomNotFoundError, ROOM_TTL_SECONDS } from "./roomStore.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "LOBBY",
    players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
    center: [],
    night: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("roomStore", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("round-trips a room through createRoom/getRoom", async () => {
    const state = fixture("ABCD");
    await createRoom(state);
    const loaded = await getRoom("ABCD");
    expect(loaded).toEqual(state);
  });

  it("returns null for an unknown room code", async () => {
    expect(await getRoom("ZZZZ")).toBeNull();
  });

  it("saveRoom overwrites and persists updates", async () => {
    const state = fixture("EFGH");
    await createRoom(state);
    await saveRoom({ ...state, phase: "ROLE_SELECT", updatedAt: 2 });
    const loaded = await getRoom("EFGH");
    expect(loaded?.phase).toBe("ROLE_SELECT");
  });

  it("deleteRoom removes the room", async () => {
    const state = fixture("IJKL");
    await createRoom(state);
    await deleteRoom("IJKL");
    expect(await getRoom("IJKL")).toBeNull();
  });

  it("sets a TTL on create", async () => {
    const state = fixture("MNOP");
    await createRoom(state);
    const ttl = await getRedisClient().ttl("room:MNOP");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
  });

  it("refuses to overwrite an existing room code and reports the collision", async () => {
    const first = fixture("QRST");
    const created = await createRoom(first);
    expect(created).toBe(true);

    const second = { ...fixture("QRST"), players: [{ id: "p2", pseudo: "Mallory", isHost: true, connected: true }] };
    const collided = await createRoom(second);
    expect(collided).toBe(false);

    const loaded = await getRoom("QRST");
    expect(loaded).toEqual(first);
  });
});

describe("withRoom", () => {
  it("applies a mutation and returns the updated state", async () => {
    const state = fixture("WITH");
    await createRoom(state);

    const updated = await withRoom("WITH", (room) => ({ ...room, phase: "ROLE_SELECT" }));

    expect(updated.phase).toBe("ROLE_SELECT");
    expect((await getRoom("WITH"))?.phase).toBe("ROLE_SELECT");
  });

  it("throws RoomNotFoundError for an unknown room code", async () => {
    await expect(withRoom("NOPE", (room) => room)).rejects.toThrow(RoomNotFoundError);
  });

  it("resolves concurrent mutations without losing any write", async () => {
    const state = fixture("CONC");
    await createRoom(state);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withRoom("CONC", (room) => ({
          ...room,
          players: [...room.players, { id: `p${i}`, pseudo: `P${i}`, isHost: false, connected: true }],
          updatedAt: Date.now(),
        })),
      ),
    );

    const loaded = await getRoom("CONC");
    expect(loaded?.players).toHaveLength(1 + 8);
  });
});
