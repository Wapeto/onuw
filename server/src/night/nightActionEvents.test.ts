import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerNightActionEvents } from "./nightActionEvents.js";
import type { NightTick } from "./nightOrder.js";

const TEST_ORDER: NightTick[] = [
  { tickId: "seer", baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "seer" },
  { tickId: "werewolf", baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "werewolf" },
];

function fixture(roomCode: string, tickIndex: number): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", currentRoleId: "seer", originalRoleId: "seer" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", currentRoleId: "werewolf", originalRoleId: "werewolf" },
    ],
    center: ["villager", "tanner", "hunter"],
    night: {
      tickIndex,
      tickStartedAt: Date.now(),
      durationMs: 100,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    },
    roleSelection: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    on: (event: string, cb: (payload: unknown) => void) => handlers.set(event, cb),
    emit: vi.fn(),
    trigger: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

describe("registerNightActionEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("resolves the acting player's action for the current tick and emits ACTION_RESULT privately", async () => {
    await createRoom(fixture("ABCD", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "seer",
      params: { mode: "center", centerIndices: [0, 1] },
    });

    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "seer",
      result: { roleIds: ["villager", "tanner"] },
    });
  });

  it("rejects an action submitted for a tick that isn't current", async () => {
    await createRoom(fixture("EFGH", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "EFGH", playerId: "p2" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "werewolf", params: {} });

    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.stringContaining("terminé") });
  });

  it("rejects an action from a player who isn't active this tick", async () => {
    await createRoom(fixture("IJKL", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "IJKL", playerId: "p2" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "seer", params: { mode: "center", centerIndices: [0, 1] } });

    const room = await getRoom("IJKL");
    expect(room?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("werewolf");
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.any(String) });
  });
});
