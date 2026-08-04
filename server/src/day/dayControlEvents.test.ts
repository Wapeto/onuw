import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerDayControlEvents } from "./dayControlEvents.js";
import { createDayTimer } from "./dayTimer.js";

function fixture(roomCode: string, overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode,
    phase: "DAY",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
    ],
    center: [],
    roleReveal: null,
    night: null,
    day: { startedAt: Date.now(), durationMs: 240_000 },
    vote: null,
    reveal: null,
    roleSelection: null,
    lastRoleSelection: null,
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    on: (event: string, handler: (payload: unknown) => unknown) => handlers.set(event, handler),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    trigger: (event: string, payload?: unknown) => handlers.get(event)!(payload),
    emitted,
  };
}

/** Lets an assertion run after the handler's detached async work settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("registerDayControlEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("lets the host end the discussion early and opens the vote", async () => {
    await createRoom(fixture("ABCD"));
    const broadcast = vi.fn();
    const dayTimer = createDayTimer({ broadcast, scheduleAdvance: vi.fn() });
    const socket = fakeSocket();
    registerDayControlEvents(socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }), dayTimer);

    socket.trigger("SKIP_DAY");
    await flush();

    const room = await getRoom("ABCD");
    expect(room?.phase).toBe("VOTE");
    expect(room?.day).toBeNull();
    expect(broadcast).toHaveBeenCalledWith("ABCD", "VOTE_START", {});
  });

  it("refuses a non-host and leaves the discussion running", async () => {
    await createRoom(fixture("EFGH"));
    const dayTimer = createDayTimer({ broadcast: vi.fn(), scheduleAdvance: vi.fn() });
    const socket = fakeSocket();
    registerDayControlEvents(socket as never, () => ({ roomCode: "EFGH", playerId: "p2" }), dayTimer);

    socket.trigger("SKIP_DAY");
    await flush();

    expect((await getRoom("EFGH"))?.phase).toBe("DAY");
    expect(socket.emitted).toContainEqual({
      event: "ROOM_ERROR",
      payload: { message: "seul l'hôte peut faire cette action" },
    });
  });

  it("refuses outside the day phase", async () => {
    await createRoom(fixture("IJKL", { phase: "NIGHT", day: null }));
    const dayTimer = createDayTimer({ broadcast: vi.fn(), scheduleAdvance: vi.fn() });
    const socket = fakeSocket();
    registerDayControlEvents(socket as never, () => ({ roomCode: "IJKL", playerId: "p1" }), dayTimer);

    socket.trigger("SKIP_DAY");
    await flush();

    expect((await getRoom("IJKL"))?.phase).toBe("NIGHT");
    expect(socket.emitted.map((e) => e.event)).toContain("ROOM_ERROR");
  });

  it("makes the original day timeout a no-op once the day was skipped", async () => {
    // The timer armed at DAY_START is still pending; it must not drag a room
    // that has already moved on back through another transition.
    await createRoom(fixture("MNOP"));
    const broadcast = vi.fn();
    const dayTimer = createDayTimer({ broadcast, scheduleAdvance: vi.fn() });
    const startedAt = (await getRoom("MNOP"))!.day!.startedAt;
    const socket = fakeSocket();
    registerDayControlEvents(socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }), dayTimer);

    socket.trigger("SKIP_DAY");
    await flush();
    await dayTimer.endDay("MNOP", startedAt);

    expect((await getRoom("MNOP"))?.phase).toBe("VOTE");
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
