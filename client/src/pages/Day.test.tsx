import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PublicPlayer } from "@onuw/shared";
import Day from "./Day";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
    ] as PublicPlayer[],
    daySession: null,
    voteStarted: false,
    skipDay: () => {},
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/day" element={<Day />} />
        <Route path="/room/:roomCode/vote" element={<div>vote-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Day", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useRoomSocket).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a waiting message before the day session arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCD/day");
    expect(screen.getByText(/en attente/i)).toBeInTheDocument();
  });

  it("shows the initial duration and counts down every second", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 125_000 } }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");
    expect(screen.getByText("2:05")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("lets the host cut the discussion short", () => {
    const skipDay = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 240_000 }, skipDay }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");

    fireEvent.click(screen.getByRole("button", { name: "Passer au vote" }));
    expect(skipDay).toHaveBeenCalled();
  });

  it("offers no skip button to a player who isn't the host", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        playerId: "p2",
        daySession: { durationMs: 240_000 },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");

    expect(screen.queryByRole("button", { name: "Passer au vote" })).not.toBeInTheDocument();
    expect(screen.getByText(/peut lancer le vote plus tôt/)).toBeInTheDocument();
  });

  it("navigates to the vote page once voteStarted is true", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 60_000 }, voteStarted: true }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");
    expect(screen.getByText("vote-page")).toBeInTheDocument();
  });
});
