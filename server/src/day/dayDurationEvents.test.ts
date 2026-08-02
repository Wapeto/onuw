import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerDayDurationEvents } from "./dayDurationEvents.js";

function fixture(roomCode: string, overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode,
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
    ],
    center: [],
    night: null,
    day: null,
    vote: null,
    roleSelection: { mode: "classic", roles: {} },
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
    trigger: (event: string, payload: unknown) => handlers.get(event)!(payload),
    emitted,
  };
}

describe("registerDayDurationEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("lets the host set a valid duration and broadcasts DAY_DURATION_UPDATE to the room", async () => {
    await createRoom(fixture("ABCD"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const toSpy = vi.fn(() => ({ emit: vi.fn() }));
    io.to = toSpy;
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }));

    await socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });

    const room = await getRoom("ABCD");
    expect(room?.dayDurationMs).toBe(180_000);
    expect(toSpy).toHaveBeenCalledWith("ABCD");
  });

  it("rejects a non-host", async () => {
    await createRoom(fixture("EFGH"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "EFGH", playerId: "p2" }));

    await socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });

    const room = await getRoom("EFGH");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "seul l'hôte peut faire cette action" } });
  });

  it("rejects a duration outside the allowed bounds", async () => {
    await createRoom(fixture("IJKL"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "IJKL", playerId: "p1" }));

    await socket.trigger("SET_DAY_DURATION", { durationMs: 999_999_999 });

    const room = await getRoom("IJKL");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "durée de jour invalide" } });
  });

  it("rejects the change once the room has left ROLE_SELECT", async () => {
    await createRoom(fixture("MNOP", { phase: "NIGHT", roleSelection: null }));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }));

    await socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });

    const room = await getRoom("MNOP");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "action impossible dans la phase actuelle de la partie" } });
  });
});
