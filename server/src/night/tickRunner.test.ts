import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom } from "../rooms/roomStore.js";
import { createTickRunner } from "./tickRunner.js";
import type { NightTick } from "./nightOrder.js";

const TEST_ORDER: NightTick[] = [
  { tickId: "doppelganger" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "doppelganger" },
  { tickId: "werewolf" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "werewolf" },
];

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    // The night is started from the briefing phase now, not straight off
    // the deal.
    phase: "ROLE_REVEAL",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "token1", currentRoleId: "doppelganger" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "token2", currentRoleId: "werewolf" },
    ],
    center: [],
    roleReveal: { readyPlayerIds: [] },
    night: null,
    roleSelection: null,
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
    expect(broadcast).toHaveBeenCalledWith("ABCD", "TICK_START", {
      tickIndex: 0,
      tickId: "doppelganger",
      durationMs: 100,
      tickNumber: 1,
      tickCount: 2,
    });
    expect(emitToPlayer).toHaveBeenCalledWith("p1", "TICK_PAYLOAD", { tickId: "doppelganger", active: true });
    expect(emitToPlayer).toHaveBeenCalledWith("p2", "TICK_PAYLOAD", { tickId: "doppelganger", active: false });
    expect(scheduleAdvance).toHaveBeenCalledWith("ABCD", 100, expect.any(Number));
  });

  it("resets resolvedActions to an empty map at the start of each tick", async () => {
    await createRoom(fixture("RSET"));
    const runner = createTickRunner({
      broadcast: vi.fn(),
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("RSET");
    expect((await getRoom("RSET"))?.night?.resolvedActions).toEqual({});

    const room = await getRoom("RSET");
    await saveRoom({ ...room!, night: { ...room!.night!, resolvedActions: { p1: 1 } } });

    await runner.advanceTick("RSET");
    const advanced = await getRoom("RSET");
    expect(advanced?.night?.tickIndex).toBe(1);
    expect(advanced?.night?.resolvedActions).toEqual({});
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
    expect(broadcast).toHaveBeenCalledWith("EFGH", "TICK_START", {
      tickIndex: 1,
      tickId: "werewolf",
      durationMs: 100,
      tickNumber: 2,
      tickCount: 2,
    });
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

  it("advanceTick past the last tick calls onNightEnd with the room code", async () => {
    await createRoom(fixture("ONEND"));
    const onNightEnd = vi.fn();
    const runner = createTickRunner({
      broadcast: vi.fn(),
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      onNightEnd,
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("ONEND");
    await runner.advanceTick("ONEND");
    await runner.advanceTick("ONEND");

    expect(onNightEnd).toHaveBeenCalledWith("ONEND");
  });

  it("advanceTick past the last tick without onNightEnd configured still ends the night", async () => {
    await createRoom(fixture("NOEND"));
    const runner = createTickRunner({
      broadcast: vi.fn(),
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("NOEND");
    await runner.advanceTick("NOEND");
    await expect(runner.advanceTick("NOEND")).resolves.toBeUndefined();
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
    expect(scheduleAdvance).toHaveBeenLastCalledWith("MNOP", expect.any(Number), expect.any(Number));
  });

  it("a stale scheduleAdvance timer (armed before a pause/resume) becomes a safe no-op", async () => {
    await createRoom(fixture("STALE"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance,
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("STALE");
    const staleToken = scheduleAdvance.mock.calls[0][2] as number;

    await runner.pauseTick("STALE");
    // Real delay so the resume's Date.now()-derived token is guaranteed distinct
    // from the stale one, even on a fast test machine.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await runner.resumeTick("STALE");
    const freshToken = scheduleAdvance.mock.calls.at(-1)![2] as number;
    expect(freshToken).not.toBe(staleToken);

    // The stale timer (armed before pause) fires late with its old token — must no-op.
    await runner.advanceTick("STALE", staleToken);
    let room = await getRoom("STALE");
    expect(room?.night?.tickIndex).toBe(0);
    expect(room?.night?.paused).toBe(false);

    // The fresh timer (armed by resume) fires with the current token — must advance.
    await runner.advanceTick("STALE", freshToken);
    room = await getRoom("STALE");
    expect(room?.night?.tickIndex).toBe(1);
  });
});
