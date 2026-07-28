import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom, deleteRoom, ROOM_TTL_SECONDS } from "./roomStore.js";

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
});
