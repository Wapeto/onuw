import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "./roomStore.js";
import { createDisconnectHandler } from "./disconnectHandler.js";

function fixture(roomCode: string, phase: GameState["phase"]): GameState {
  return {
    roomCode,
    phase,
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
    ],
    center: [],
    night:
      phase === "NIGHT"
        ? {
            tickIndex: 0,
            tickStartedAt: Date.now(),
            durationMs: 5000,
            paused: false,
            remainingMsAtPause: null,
            doppelgangerCopiedRoleId: null,
            doppelgangerCopiedPlayerId: null,
          }
        : null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("disconnectHandler", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("marks the player disconnected silently outside NIGHT, without pausing", async () => {
    await createRoom(fixture("ABCD", "DAY"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick } });

    await handler.handleDisconnect("ABCD", "p1");

    const room = await getRoom("ABCD");
    expect(room?.players.find((p) => p.id === "p1")?.connected).toBe(false);
    expect(pauseTick).not.toHaveBeenCalled();
  });

  it("pauses the tick on disconnect during NIGHT", async () => {
    await createRoom(fixture("EFGH", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const handler = createDisconnectHandler({
      tickRunner: { pauseTick, resumeTick },
      scheduleGraceTimeout: vi.fn(),
    });

    await handler.handleDisconnect("EFGH", "p1");

    expect(pauseTick).toHaveBeenCalledWith("EFGH");
    const room = await getRoom("EFGH");
    expect(room?.players.find((p) => p.id === "p1")?.connected).toBe(false);
  });

  it("resumes the tick if the player reconnects before grace expires", async () => {
    await createRoom(fixture("IJKL", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const scheduleGraceTimeout = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout });

    await handler.handleDisconnect("IJKL", "p1");
    await handler.handleReconnect("IJKL", "p1");

    expect(resumeTick).toHaveBeenCalledWith("IJKL");
    // the grace timeout callback must be a no-op if later invoked, since reconnection already resumed
    const graceCallback = scheduleGraceTimeout.mock.calls[0][0] as () => Promise<void>;
    resumeTick.mockClear();
    await graceCallback();
    expect(resumeTick).not.toHaveBeenCalled();
  });

  it("resumes the tick when the grace period expires with no reconnection", async () => {
    await createRoom(fixture("MNOP", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const scheduleGraceTimeout = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout });

    await handler.handleDisconnect("MNOP", "p1");
    const graceCallback = scheduleGraceTimeout.mock.calls[0][0] as () => Promise<void>;
    await graceCallback();

    expect(resumeTick).toHaveBeenCalledWith("MNOP");
  });
});
