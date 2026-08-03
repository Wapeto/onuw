import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRoomSocket } from "./useRoomSocket";

const mockSocket = vi.hoisted(() => {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  return {
    on(event: string, cb: (payload: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    },
    trigger(event: string, payload: unknown) {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    },
    reset() {
      handlers.clear();
    },
    emit: vi.fn(),
    close: vi.fn(),
  };
});

vi.mock("socket.io-client", () => ({
  io: () => mockSocket,
}));

describe("useRoomSocket", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockSocket.reset();
    mockSocket.emit.mockClear();
  });

  it("stores roomCode/playerId/reconnectToken in sessionStorage on ROOM_CREATED", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROOM_CREATED", { roomCode: "ABCDE", playerId: "p1", reconnectToken: "tok-1" });
    });

    expect(result.current.roomCode).toBe("ABCDE");
    expect(result.current.playerId).toBe("p1");
    expect(sessionStorage.getItem("onuw:roomCode")).toBe("ABCDE");
    expect(sessionStorage.getItem("onuw:playerId")).toBe("p1");
    expect(sessionStorage.getItem("onuw:reconnectToken")).toBe("tok-1");
  });

  it("updates players on PLAYER_LIST_UPDATE", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("PLAYER_LIST_UPDATE", {
        players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      });
    });

    expect(result.current.players).toHaveLength(1);
    expect(result.current.players[0].pseudo).toBe("Alice");
  });

  it("surfaces ROOM_ERROR messages", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROOM_ERROR", { message: "room not found" });
    });

    expect(result.current.error).toBe("room not found");
  });

  it("emits CREATE_ROOM with the given pseudo", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.createRoom("Alice");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("CREATE_ROOM", { pseudo: "Alice" });
  });

  it("emits JOIN_ROOM with the given code and pseudo", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.joinRoom("ABCDE", "Bob");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("JOIN_ROOM", { roomCode: "ABCDE", pseudo: "Bob" });
  });

  it("updates roleSelection on ROLE_SELECTION_UPDATE", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROLE_SELECTION_UPDATE", {
        mode: "classic",
        roles: { werewolf: 2, villager: 1 },
        valid: true,
      });
    });

    expect(result.current.roleSelection).toEqual({
      mode: "classic",
      roles: { werewolf: 2, villager: 1 },
      valid: true,
    });
  });

  it("emits START_ROLE_SELECT", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.startRoleSelect();
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("START_ROLE_SELECT");
  });

  it("emits SET_ROLE_MODE with the given mode", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.setRoleMode("simple");
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SET_ROLE_MODE", { mode: "simple" });
  });

  it("emits SET_CUSTOM_ROLES with the given roles", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.setCustomRoles({ werewolf: 2 });
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SET_CUSTOM_ROLES", { roles: { werewolf: 2 } });
  });

  it("emits START_GAME", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.startGame();
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("START_GAME");
  });

  it("tracks the current tick across TICK_START then TICK_PAYLOAD", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("TICK_START", { tickIndex: 2, tickId: "seer", durationMs: 8000 });
    });
    expect(result.current.currentTick).toEqual({ tickIndex: 2, tickId: "seer", durationMs: 8000, active: false });

    act(() => {
      mockSocket.trigger("TICK_PAYLOAD", { tickId: "seer", active: true });
    });
    expect(result.current.currentTick?.active).toBe(true);
  });

  it("tracks pause/resume and clears on NIGHT_END", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("TICK_START", { tickIndex: 0, tickId: "doppelganger", durationMs: 8000 });
      mockSocket.trigger("TICK_PAUSED", {});
    });
    expect(result.current.nightPaused).toBe(true);

    act(() => {
      mockSocket.trigger("TICK_RESUMED", { remainingMs: 3000 });
    });
    expect(result.current.nightPaused).toBe(false);

    act(() => {
      mockSocket.trigger("NIGHT_END", {});
    });
    expect(result.current.nightEnded).toBe(true);
    expect(result.current.currentTick).toBeNull();
  });

  it("submitNightAction emits SUBMIT_NIGHT_ACTION and ACTION_RESULT updates actionResult", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.submitNightAction("robber", { targetPlayerId: "p2" });
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SUBMIT_NIGHT_ACTION", { tickId: "robber", params: { targetPlayerId: "p2" } });

    act(() => {
      mockSocket.trigger("ACTION_RESULT", { tickId: "robber", result: { newRoleId: "villager" } });
    });
    expect(result.current.actionResult).toEqual({ tickId: "robber", result: { newRoleId: "villager" } });
  });
});

describe("day/vote state", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockSocket.reset();
    mockSocket.emit.mockClear();
  });

  it("DAY_START sets daySession and resets vote state; VOTE_START flips voteStarted; VOTE_RESULT sets voteResult", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("DAY_START", { durationMs: 180_000 });
    });
    expect(result.current.daySession).toEqual({ durationMs: 180_000 });
    expect(result.current.voteStarted).toBe(false);
    expect(result.current.voteResult).toBeNull();

    act(() => {
      mockSocket.trigger("VOTE_START", {});
    });
    expect(result.current.voteStarted).toBe(true);

    act(() => {
      mockSocket.trigger("VOTE_RESULT", { tally: { p1: 2 }, eliminated: ["p1"] });
    });
    expect(result.current.voteResult).toEqual({ tally: { p1: 2 }, eliminated: ["p1"] });
  });

  it("DAY_DURATION_UPDATE sets dayDurationMs; setDayDuration/submitVote emit the right events", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("DAY_DURATION_UPDATE", { durationMs: 300_000 });
    });
    expect(result.current.dayDurationMs).toBe(300_000);

    act(() => {
      result.current.setDayDuration(120_000);
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SET_DAY_DURATION", { durationMs: 120_000 });

    act(() => {
      result.current.submitVote("p2");
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SUBMIT_VOTE", { targetPlayerId: "p2" });
  });

  it("stores the reveal result on REVEAL_RESULT", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("REVEAL_RESULT", {
        eliminated: ["p1"],
        winningTeam: "village",
        winners: ["p2"],
        tally: { p1: 2, p2: 1 },
        players: [{ id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" }],
      });
    });

    expect(result.current.revealResult?.winningTeam).toBe("village");
    expect(result.current.revealResult?.players[0].pseudo).toBe("Alice");
  });

  it("emits REPLAY when replay() is called", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.replay();
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("REPLAY");
  });
});
