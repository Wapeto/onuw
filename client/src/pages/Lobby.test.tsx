import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Lobby from "./Lobby";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));
vi.mock("../components/RoomQrCode", () => ({
  default: ({ roomCode }: { roomCode: string }) => <div data-testid="qr">{roomCode}</div>,
}));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCDE",
    playerId: "p1",
    // 3 players by default (not 2, unlike Phase 2's fixture) so the Lancer button
    // is enabled out of the box — MIN_PLAYERS is 3; tests that care about the
    // below-minimum case override `players` explicitly.
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
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
    dayDurationMs: 240_000,
    daySession: null,
    voteStarted: false,
    voteResult: null,
    setDayDuration: vi.fn(),
    submitVote: vi.fn(),
    revealResult: null,
    replay: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode" element={<Lobby />} />
        <Route path="/room/:roomCode/roles" element={<div>role-select-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Lobby", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
  });

  it("lists every player's pseudo", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText(/^Alice/)).toBeInTheDocument();
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

  it("shows a Lancer button to the host when player count is in range", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeEnabled();
  });

  it("hides the Lancer button from a non-host", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ playerId: "p2" }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE");
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });

  it("disables the Lancer button when there are fewer than 3 players", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }] }) as ReturnType<
        typeof useRoomSocket
      >,
    );
    renderAt("/room/ABCDE");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeDisabled();
  });

  it("calls startRoleSelect when the host clicks Lancer", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE");
    screen.getByRole("button", { name: /lancer/i }).click();
    expect(session.startRoleSelect).toHaveBeenCalled();
  });

  it("navigates to the role-select page once roleSelection is set", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ roleSelection: { mode: "classic", roles: {}, valid: true } }) as ReturnType<
        typeof useRoomSocket
      >,
    );
    renderAt("/room/ABCDE");
    expect(screen.getByText("role-select-page")).toBeInTheDocument();
  });
});
