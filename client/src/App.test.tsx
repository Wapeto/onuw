import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { useRoomSocket } from "./hooks/useRoomSocket";

vi.mock("./hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

describe("App", () => {
  it("renders Home at the root route", () => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "",
      playerId: "",
      players: [],
      roleSelection: null,
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      startRoleSelect: vi.fn(),
      setRoleMode: vi.fn(),
      setCustomRoles: vi.fn(),
      startGame: vi.fn(),
      currentTick: null,
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: /one night ultimate werewolf/i })).toBeInTheDocument();
  });

  it("renders RoleSelect at /room/:roomCode/roles", () => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "",
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      roleSelection: { mode: "classic", roles: { werewolf: 2, villager: 1 }, valid: true },
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      startRoleSelect: vi.fn(),
      setRoleMode: vi.fn(),
      setCustomRoles: vi.fn(),
      startGame: vi.fn(),
      currentTick: null,
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
    });
    window.history.pushState({}, "", "/room/ABCDE/roles");
    render(<App />);
    expect(screen.getByRole("heading", { name: /configuration des rôles/i })).toBeInTheDocument();
  });
});
