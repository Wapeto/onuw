import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom } from "../rooms/roomStore.js";
import { createDayTimer } from "./dayTimer.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
    ],
    center: [],
    night: null,
    day: null,
    vote: null,
    roleSelection: null,
    dayDurationMs: 200,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("dayTimer", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("startDay reads dayDurationMs off the room, saves day state, and broadcasts DAY_START", async () => {
    await createRoom(fixture("ABCD"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance });

    await timer.startDay("ABCD");

    const room = await getRoom("ABCD");
    expect(room?.day?.durationMs).toBe(200);
    expect(broadcast).toHaveBeenCalledWith("ABCD", "DAY_START", { durationMs: 200 });
    expect(scheduleAdvance).toHaveBeenCalledWith("ABCD", 200, expect.any(Number));
  });

  it("endDay transitions DAY to VOTE, clears day, opens an empty vote, and broadcasts VOTE_START", async () => {
    await createRoom(fixture("EFGH"));
    const broadcast = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance: vi.fn() });

    await timer.startDay("EFGH");
    await timer.endDay("EFGH");

    const room = await getRoom("EFGH");
    expect(room?.phase).toBe("VOTE");
    expect(room?.day).toBeNull();
    expect(room?.vote).toEqual({ votes: {} });
    expect(broadcast).toHaveBeenCalledWith("EFGH", "VOTE_START", {});
  });

  it("a stale endDay token (armed before a fresh startDay) is a safe no-op", async () => {
    await createRoom(fixture("STALE"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance });

    await timer.startDay("STALE");
    const staleToken = scheduleAdvance.mock.calls[0][2] as number;

    let room = await getRoom("STALE");
    await saveRoom({ ...room!, day: { startedAt: Date.now(), durationMs: 200 } });

    await timer.endDay("STALE", staleToken);
    room = await getRoom("STALE");
    expect(room?.phase).toBe("NIGHT");
    expect(room?.day).not.toBeNull();
  });
});
