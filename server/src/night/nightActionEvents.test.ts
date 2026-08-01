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

  it("rejects an unknown/missing tickId instead of throwing on an undefined schema lookup", async () => {
    await createRoom(fixture("MNOP", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }), TEST_ORDER);

    // If the handler let an unknown tickId reach `actionParamsSchemas[tickId].safeParse(...)`,
    // the lookup would be undefined and `.safeParse` would throw a TypeError outside the
    // try/catch — surfacing here as a rejected promise that fails this `await`, not a silent
    // process crash. Resolving cleanly with a ROOM_ERROR emit is the proof the guard works.
    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "not-a-real-tick", params: {} });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.any(String) });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", { params: {} });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.any(String) });
  });
});

const ROBBER_ORDER: NightTick[] = [
  { tickId: "robber", baseDurationMs: 100, activeFor: (p) => p.originalRoleId === "robber" },
];

function robberFixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", currentRoleId: "robber", originalRoleId: "robber" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", currentRoleId: "villager", originalRoleId: "villager" },
    ],
    center: ["tanner", "hunter", "seer"],
    night: {
      tickIndex: 0,
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

const DG_ORDER: NightTick[] = [
  { tickId: "doppelganger", baseDurationMs: 100, activeFor: (p) => p.originalRoleId === "doppelganger" },
];

function doppelgangerFixture(roomCode: string, targetRoleId: "robber" | "drunk"): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", currentRoleId: "doppelganger", originalRoleId: "doppelganger" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", currentRoleId: targetRoleId, originalRoleId: targetRoleId },
    ],
    center: ["tanner", "hunter", "seer"],
    night: {
      tickIndex: 0,
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

describe("registerNightActionEvents duplicate-submission guard", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("rejects a second identical submit for the same tick and does not reverse the robber swap", async () => {
    await createRoom(robberFixture("ROB1"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "ROB1", playerId: "p1" }), ROBBER_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "robber", params: { targetPlayerId: "p2" } });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", { tickId: "robber", result: { newRoleId: "villager" } });

    const afterFirst = await getRoom("ROB1");
    expect(afterFirst?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("villager");
    expect(afterFirst?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("robber");

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "robber", params: { targetPlayerId: "p2" } });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "tu as déjà agi ce tour" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());

    const afterSecond = await getRoom("ROB1");
    expect(afterSecond?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("villager");
    expect(afterSecond?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("robber");
  });

  it("allows exactly two doppelganger submits (phase 1 then phase 2) and rejects a third", async () => {
    await createRoom(doppelgangerFixture("DG1", "robber"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "DG1", playerId: "p1" }), DG_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "doppelganger", params: { targetPlayerId: "p2" } });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", { tickId: "doppelganger", result: { copiedRoleId: "robber" } });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "doppelganger",
      result: { copiedRoleId: "robber", chained: { newRoleId: "robber" } },
    });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "tu as déjà agi ce tour" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());
  });

  it("rejects an invalid chained doppelganger subParams before it reaches the resolver", async () => {
    await createRoom(doppelgangerFixture("DG2", "drunk"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "DG2", playerId: "p1" }), DG_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { centerIndex: 99 } },
    });

    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "action de nuit invalide" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());

    const room = await getRoom("DG2");
    expect(room?.night?.resolvedActions?.p1?.phase2 ?? false).toBe(false);
    expect(room?.center).toEqual(["tanner", "hunter", "seer"]);
  });

  it("rejects a second phase-2 doppelganger-copies-robber submit without re-running the chained swap", async () => {
    await createRoom(doppelgangerFixture("DGR2", "robber"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "DGR2", playerId: "p1" }), DG_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "doppelganger", params: { targetPlayerId: "p2" } });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "doppelganger",
      result: { copiedRoleId: "robber", chained: { newRoleId: "robber" } },
    });

    const afterFirstPhase2 = await getRoom("DGR2");
    expect(afterFirstPhase2?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("robber");
    expect(afterFirstPhase2?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("doppelganger");

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "tu as déjà agi ce tour" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());

    const afterSecondPhase2 = await getRoom("DGR2");
    expect(afterSecondPhase2?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("robber");
    expect(afterSecondPhase2?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("doppelganger");
  });

  it("rejects a second phase-2 doppelganger-copies-drunk submit without re-running the chained swap", async () => {
    await createRoom(doppelgangerFixture("DGD2", "drunk"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "DGD2", playerId: "p1" }), DG_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "doppelganger", params: { targetPlayerId: "p2" } });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { centerIndex: 0 } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "doppelganger",
      result: { copiedRoleId: "drunk", chained: {} },
    });

    const afterFirstPhase2 = await getRoom("DGD2");
    expect(afterFirstPhase2?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("tanner");
    expect(afterFirstPhase2?.center).toEqual(["doppelganger", "hunter", "seer"]);

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { centerIndex: 0 } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "tu as déjà agi ce tour" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());

    const afterSecondPhase2 = await getRoom("DGD2");
    expect(afterSecondPhase2?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("tanner");
    expect(afterSecondPhase2?.center).toEqual(["doppelganger", "hunter", "seer"]);
  });

  it("allows a legitimate phase-2 after a double-tapped phase-1 (no false lockout)", async () => {
    await createRoom(doppelgangerFixture("DGP1", "robber"));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "DGP1", playerId: "p1" }), DG_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "doppelganger", params: { targetPlayerId: "p2" } });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", { tickId: "doppelganger", result: { copiedRoleId: "robber" } });

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "doppelganger", params: { targetPlayerId: "p2" } });
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: "tu as déjà agi ce tour" });
    expect(socket.emit).not.toHaveBeenCalledWith("ACTION_RESULT", expect.anything());

    socket.emit.mockClear();
    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "doppelganger",
      params: { targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } },
    });
    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "doppelganger",
      result: { copiedRoleId: "robber", chained: { newRoleId: "robber" } },
    });

    const room = await getRoom("DGP1");
    expect(room?.players.find((p) => p.id === "p1")?.currentRoleId).toBe("robber");
    expect(room?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("doppelganger");
  });
});
