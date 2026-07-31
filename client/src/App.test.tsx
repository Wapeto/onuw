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
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: /one night ultimate werewolf/i })).toBeInTheDocument();
  });
});
