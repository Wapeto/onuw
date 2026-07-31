import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Lobby from "./Lobby";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));
vi.mock("../components/RoomQrCode", () => ({
  default: ({ roomCode }: { roomCode: string }) => <div data-testid="qr">{roomCode}</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode" element={<Lobby />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Lobby", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "ABCDE",
      playerId: "p1",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      ],
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
    });
  });

  it("lists every player's pseudo", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("marks the host in the roster", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText(/Alice.*hôte/i)).toBeInTheDocument();
  });

  it("renders the QR code for the room code from the route", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByTestId("qr")).toHaveTextContent("ABCDE");
  });

  it("does not render a launch control (deferred to Phase 3)", () => {
    renderAt("/room/ABCDE");
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });
});
