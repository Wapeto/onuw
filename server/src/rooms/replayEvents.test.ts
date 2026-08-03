import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerReplayEvents } from "./replayEvents.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "REVEAL",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", originalRoleId: "villager", currentRoleId: "villager" },
      { id: "p3", pseudo: "Carol", isHost: false, connected: true, reconnectToken: "t3", originalRoleId: "villager", currentRoleId: "villager" },
    ],
    center: ["seer"],
    night: null,
    day: null,
    vote: null,
    reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2"], tally: { p1: 2 } },
    roleSelection: null,
    lastRoleSelection: { mode: "classic", roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } },
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
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

function fakeIo() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  return {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
    }),
    emitted,
  };
}

describe("registerReplayEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("resets the room to ROLE_SELECT with players/roles cleared and the last selection restored", async () => {
    await createRoom(fixture("UVWX"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "UVWX", playerId: "p1" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("UVWX");
    expect(room?.phase).toBe("ROLE_SELECT");
    expect(room?.center).toEqual([]);
    expect(room?.night).toBeNull();
    expect(room?.day).toBeNull();
    expect(room?.vote).toBeNull();
    expect(room?.reveal).toBeNull();
    expect(room?.players.every((p) => p.originalRoleId === undefined && p.currentRoleId === undefined)).toBe(true);
    expect(room?.roleSelection).toEqual({
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
    });

    const updateEvent = io.emitted.find((e) => e.event === "ROLE_SELECTION_UPDATE");
    expect(updateEvent?.payload).toEqual({
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      valid: true,
    });
  });

  it("rejects REPLAY from a non-host", async () => {
    await createRoom(fixture("YZAB"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "YZAB", playerId: "p2" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("YZAB");
    expect(room?.phase).toBe("REVEAL");
    expect(socket.emitted.find((e) => e.event === "ROOM_ERROR")?.payload).toEqual({
      message: "seul l'hôte peut relancer une partie",
    });
  });

  it("rejects REPLAY outside of REVEAL", async () => {
    await createRoom({ ...fixture("CDEF"), phase: "LOBBY" });
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "CDEF", playerId: "p1" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("CDEF");
    expect(room?.phase).toBe("LOBBY");
    expect(socket.emitted.find((e) => e.event === "ROOM_ERROR")).toBeDefined();
  });
});
