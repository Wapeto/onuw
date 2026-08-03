import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Reveal from "./Reveal";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCD",
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
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
        <Route path="/room/:roomCode/reveal" element={<Reveal />} />
        <Route path="/room/:roomCode/roles" element={<div>roles-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Reveal", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReset();
  });

  it("shows a waiting message before the reveal result arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCD/reveal");
    expect(screen.getByText(/en attente/i)).toBeInTheDocument();
  });

  it("shows the winning team and each player's original/final role", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: {
          eliminated: ["p1"],
          winningTeam: "village",
          winners: ["p2"],
          tally: { p1: 2, p2: 1 },
          players: [
            { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
            { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
          ],
        },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.getByText(/village gagne/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/loup-garou/i)).toBeInTheDocument();
    expect(screen.getByText(/éliminé/i)).toBeInTheDocument();
    expect(screen.getByText(/2 voix/i)).toBeInTheDocument();
  });

  it("shows the Rejouer button only for the host, and calls replay() on click", () => {
    const replay = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], tally: {}, players: [] },
        replay,
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    const button = screen.getByRole("button", { name: /rejouer/i });
    fireEvent.click(button);
    expect(replay).toHaveBeenCalled();
  });

  it("hides the Rejouer button from non-hosts", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        playerId: "p2",
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], tally: {}, players: [] },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.queryByRole("button", { name: /rejouer/i })).not.toBeInTheDocument();
  });

  it("navigates to the role select page once roleSelection reappears after Rejouer", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], tally: {}, players: [] },
        roleSelection: { mode: "classic", roles: { werewolf: 2 }, valid: true },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.getByText("roles-page")).toBeInTheDocument();
  });
});
