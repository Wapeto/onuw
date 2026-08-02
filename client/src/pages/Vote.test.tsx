import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Vote from "./Vote";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCD",
    playerId: "p1",
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
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/vote" element={<Vote />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Vote", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReset();
  });

  it("shows a big button per player and submits a vote on tap", () => {
    const submitVote = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(baseSession({ submitVote }) as ReturnType<typeof useRoomSocket>);

    renderAt("/room/ABCD/vote");
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));

    expect(submitVote).toHaveBeenCalledWith("p2");
    expect(screen.getByText(/enregistré/i)).toBeInTheDocument();
  });

  it("shows the tally and eliminated players once VOTE_RESULT arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        voteResult: { tally: { p1: 1, p2: 2, p3: 0 }, eliminated: ["p2"] },
      }) as ReturnType<typeof useRoomSocket>,
    );

    renderAt("/room/ABCD/vote");
    expect(screen.getByText(/Bob.*2 voix.*éliminé/is)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bob" })).not.toBeInTheDocument();
  });
});
