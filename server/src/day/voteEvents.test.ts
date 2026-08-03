import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerVoteEvents } from "./voteEvents.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "VOTE",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", originalRoleId: "villager", currentRoleId: "villager" },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true, reconnectToken: "t3", originalRoleId: "seer", currentRoleId: "seer" },
    ],
    center: [],
    night: null,
    day: null,
    vote: { votes: {} },
    reveal: null,
    roleSelection: null,
    lastRoleSelection: null,
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

describe("registerVoteEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("records a vote without resolving until every player has voted", async () => {
    await createRoom(fixture("ABCD"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });

    const room = await getRoom("ABCD");
    expect(room?.phase).toBe("VOTE");
    expect(room?.vote?.votes).toEqual({ p1: "p2" });
    expect(io.emitted.some((e) => e.event === "VOTE_RESULT")).toBe(false);
  });

  it("resolves and broadcasts VOTE_RESULT exactly once the last vote arrives, and transitions to REVEAL", async () => {
    await createRoom(fixture("EFGH"));
    const io = fakeIo();
    const s1 = fakeSocket();
    const s2 = fakeSocket();
    const s3 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "EFGH", playerId: "p1" }));
    registerVoteEvents(io as never, s2 as never, () => ({ roomCode: "EFGH", playerId: "p2" }));
    registerVoteEvents(io as never, s3 as never, () => ({ roomCode: "EFGH", playerId: "p3" }));

    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    await s2.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    expect(io.emitted.some((e) => e.event === "VOTE_RESULT")).toBe(false);

    await s3.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });

    const room = await getRoom("EFGH");
    expect(room?.phase).toBe("REVEAL");
    expect(room?.vote).toBeNull();
    const resultEvent = io.emitted.find((e) => e.event === "VOTE_RESULT");
    expect(resultEvent?.payload).toEqual({ tally: { p1: 1, p2: 2, p3: 0 }, eliminated: ["p2"] });
  });

  it("computes and persists the win conditions, and broadcasts REVEAL_RESULT alongside VOTE_RESULT", async () => {
    await createRoom(fixture("MNOP"));
    const io = fakeIo();
    const s1 = fakeSocket();
    const s2 = fakeSocket();
    const s3 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "MNOP", playerId: "p1" }));
    registerVoteEvents(io as never, s2 as never, () => ({ roomCode: "MNOP", playerId: "p2" }));
    registerVoteEvents(io as never, s3 as never, () => ({ roomCode: "MNOP", playerId: "p3" }));

    // Everyone votes p1 (the werewolf) out — Village should win.
    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });
    await s2.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });
    await s3.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });

    const room = await getRoom("MNOP");
    expect(room?.reveal).toEqual({
      eliminated: ["p1"],
      winningTeam: "village",
      winners: ["p2", "p3"],
      tally: { p1: 3, p2: 0, p3: 0 },
    });

    const revealEvent = io.emitted.find((e) => e.event === "REVEAL_RESULT");
    expect(revealEvent?.payload).toEqual({
      eliminated: ["p1"],
      winningTeam: "village",
      winners: ["p2", "p3"],
      tally: { p1: 3, p2: 0, p3: 0 },
      players: [
        { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
        { id: "p3", pseudo: "Carl", originalRoleId: "seer", currentRoleId: "seer" },
      ],
    });
  });

  it("a re-submitted vote overwrites the voter's previous choice without counting twice", async () => {
    await createRoom(fixture("IJKL"));
    const io = fakeIo();
    const s1 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "IJKL", playerId: "p1" }));

    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p3" });

    const room = await getRoom("IJKL");
    expect(room?.vote?.votes).toEqual({ p1: "p3" });
  });

  it("rejects a vote for an unknown target", async () => {
    await createRoom(fixture("MNOP"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "ghost" });

    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "cible de vote invalide" } });
  });

  it("rejects a vote outside the VOTE phase", async () => {
    const state = fixture("QRST");
    await createRoom({ ...state, phase: "DAY", vote: null });
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "QRST", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });

    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "aucun vote en cours" } });
  });
});
