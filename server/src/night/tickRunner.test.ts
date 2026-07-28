import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { createTickRunner } from "./tickRunner.js";
import type { NightTick } from "./nightOrder.js";

const TEST_ORDER: NightTick[] = [
  { tickId: "doppelganger" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "doppelganger" },
  { tickId: "werewolf" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "werewolf" },
];

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, currentRoleId: "doppelganger" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, currentRoleId: "werewolf" },
    ],
    center: [],
    night: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("tickRunner", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("startNight sets phase to NIGHT, tickIndex 0, and broadcasts TICK_START with per-player payloads", async () => {
    await createRoom(fixture("ABCD"));
    const broadcast = vi.fn();
    const emitToPlayer = vi.fn();
    const scheduleAdvance = vi.fn();
    const runner = createTickRunner({ broadcast, emitToPlayer, scheduleAdvance, nightOrder: TEST_ORDER, jitterMs: 0 });

    await runner.startNight("ABCD");

    const room = await getRoom("ABCD");
    expect(room?.phase).toBe("NIGHT");
    expect(room?.night?.tickIndex).toBe(0);
    expect(broadcast).toHaveBeenCalledWith("ABCD", "TICK_START", { tickIndex: 0, tickId: "doppelganger", durationMs: 100 });
    expect(emitToPlayer).toHaveBeenCalledWith("p1", "TICK_PAYLOAD", { tickId: "doppelganger", active: true });
    expect(emitToPlayer).toHaveBeenCalledWith("p2", "TICK_PAYLOAD", { tickId: "doppelganger", active: false });
    expect(scheduleAdvance).toHaveBeenCalledWith("ABCD", 100);
  });

  it("advanceTick moves to the next tick", async () => {
    await createRoom(fixture("EFGH"));
    const broadcast = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("EFGH");
    await runner.advanceTick("EFGH");

    const room = await getRoom("EFGH");
    expect(room?.night?.tickIndex).toBe(1);
    expect(broadcast).toHaveBeenCalledWith("EFGH", "TICK_START", { tickIndex: 1, tickId: "werewolf", durationMs: 100 });
  });

  it("advanceTick past the last tick ends the night and moves to DAY", async () => {
    await createRoom(fixture("IJKL"));
    const broadcast = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("IJKL");
    await runner.advanceTick("IJKL");
    await runner.advanceTick("IJKL");

    const room = await getRoom("IJKL");
    expect(room?.phase).toBe("DAY");
    expect(room?.night).toBeNull();
    expect(broadcast).toHaveBeenCalledWith("IJKL", "NIGHT_END", {});
  });

  it("pauseTick freezes remaining time and resumeTick reschedules with it", async () => {
    await createRoom(fixture("MNOP"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance,
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("MNOP");
    await runner.pauseTick("MNOP");

    let room = await getRoom("MNOP");
    expect(room?.night?.paused).toBe(true);
    expect(room?.night?.remainingMsAtPause).toBeLessThanOrEqual(100);
    expect(broadcast).toHaveBeenCalledWith("MNOP", "TICK_PAUSED", {});

    await runner.resumeTick("MNOP");
    room = await getRoom("MNOP");
    expect(room?.night?.paused).toBe(false);
    expect(broadcast).toHaveBeenCalledWith("MNOP", "TICK_RESUMED", { remainingMs: expect.any(Number) });
    expect(scheduleAdvance).toHaveBeenLastCalledWith("MNOP", expect.any(Number));
  });
});
