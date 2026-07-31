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
});
