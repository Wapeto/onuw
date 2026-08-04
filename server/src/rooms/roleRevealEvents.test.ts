import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerRoleRevealEvents, deckCounts, emitRoleCards, wakesAtNight } from "./roleRevealEvents.js";

function fixture(roomCode: string, overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode,
    phase: "ROLE_REVEAL",
    players: [
      {
        id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1",
        originalRoleId: "seer", currentRoleId: "seer",
      },
      {
        id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2",
        originalRoleId: "werewolf", currentRoleId: "werewolf",
      },
    ],
    center: ["villager", "robber", "tanner"],
    roleReveal: { readyPlayerIds: [] },
    night: null,
    day: null,
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

function fakeIo() {
  const sent: { room: string; event: string; payload: unknown }[] = [];
  return {
    sent,
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => sent.push({ room, event, payload }),
    }),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("role reveal", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("counts the whole deck, players and centre together", () => {
    expect(deckCounts(fixture("ABCD"))).toEqual({ seer: 1, werewolf: 1, villager: 1, robber: 1, tanner: 1 });
  });

  it("knows which roles are called during the night", () => {
    expect(wakesAtNight("seer")).toBe(true);
    expect(wakesAtNight("villager")).toBe(false);
    expect(wakesAtNight("tanner")).toBe(false);
  });

  it("sends each player their own card and nobody else's", () => {
    const io = fakeIo();
    emitRoleCards(io as never, fixture("ABCD"));

    const cards = io.sent.filter((s) => s.event === "YOUR_ROLE");
    expect(cards).toHaveLength(2);
    // Addressed to the per-player room, never to the room code — a card
    // broadcast to the whole table would end the game before it started.
    expect(cards.map((c) => c.room)).toEqual(["p1", "p2"]);
    expect(cards[0].payload).toMatchObject({ roleId: "seer", wakesAtNight: true });
    expect(cards[1].payload).toMatchObject({ roleId: "werewolf", wakesAtNight: true });
  });

  it("holds the night until every connected player is ready", async () => {
    await createRoom(fixture("EFGH"));
    const startNight = vi.fn();
    const io = fakeIo();
    const socket = fakeSocket();
    registerRoleRevealEvents(io as never, socket as never, () => ({ roomCode: "EFGH", playerId: "p1" }), {
      startNight,
    });

    socket.trigger("READY_FOR_NIGHT");
    await flush();
    expect((await getRoom("EFGH"))?.roleReveal?.readyPlayerIds).toEqual(["p1"]);
    expect(startNight).not.toHaveBeenCalled();

    const socket2 = fakeSocket();
    registerRoleRevealEvents(io as never, socket2 as never, () => ({ roomCode: "EFGH", playerId: "p2" }), {
      startNight,
    });
    socket2.trigger("READY_FOR_NIGHT");
    await flush();
    expect(startNight).toHaveBeenCalledWith("EFGH");
  });

  it("ignores a second confirmation from the same player", async () => {
    await createRoom(fixture("IJKL"));
    const startNight = vi.fn();
    const socket = fakeSocket();
    registerRoleRevealEvents(fakeIo() as never, socket as never, () => ({ roomCode: "IJKL", playerId: "p1" }), {
      startNight,
    });

    socket.trigger("READY_FOR_NIGHT");
    await flush();
    socket.trigger("READY_FOR_NIGHT");
    await flush();

    expect((await getRoom("IJKL"))?.roleReveal?.readyPlayerIds).toEqual(["p1"]);
    expect(startNight).not.toHaveBeenCalled();
  });

  it("does not wait on a player who has dropped out", async () => {
    await createRoom(
      fixture("MNOP", {
        players: [
          {
            id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1",
            originalRoleId: "seer", currentRoleId: "seer",
          },
          {
            id: "p2", pseudo: "Bob", isHost: false, connected: false, reconnectToken: "t2",
            originalRoleId: "werewolf", currentRoleId: "werewolf",
          },
        ],
      }),
    );
    const startNight = vi.fn();
    const socket = fakeSocket();
    registerRoleRevealEvents(fakeIo() as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }), {
      startNight,
    });

    socket.trigger("READY_FOR_NIGHT");
    await flush();
    expect(startNight).toHaveBeenCalledWith("MNOP");
  });

  it("lets the host start the night without waiting, but nobody else", async () => {
    await createRoom(fixture("QRST"));
    const startNight = vi.fn();
    const guest = fakeSocket();
    registerRoleRevealEvents(fakeIo() as never, guest as never, () => ({ roomCode: "QRST", playerId: "p2" }), {
      startNight,
    });
    guest.trigger("START_NIGHT");
    await flush();
    expect(startNight).not.toHaveBeenCalled();
    expect(guest.emitted.map((e) => e.event)).toContain("ROOM_ERROR");

    const host = fakeSocket();
    registerRoleRevealEvents(fakeIo() as never, host as never, () => ({ roomCode: "QRST", playerId: "p1" }), {
      startNight,
    });
    host.trigger("START_NIGHT");
    await flush();
    expect(startNight).toHaveBeenCalledWith("QRST");
  });

  it("refuses confirmations outside the briefing phase", async () => {
    await createRoom(fixture("UVWX", { phase: "DAY", roleReveal: null }));
    const startNight = vi.fn();
    const socket = fakeSocket();
    registerRoleRevealEvents(fakeIo() as never, socket as never, () => ({ roomCode: "UVWX", playerId: "p1" }), {
      startNight,
    });

    socket.trigger("READY_FOR_NIGHT");
    await flush();

    expect(startNight).not.toHaveBeenCalled();
    expect(socket.emitted.map((e) => e.event)).toContain("ROOM_ERROR");
  });
});
