import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Day from "./Day";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    daySession: null,
    voteStarted: false,
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

  it("navigates to the vote page once voteStarted is true", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 60_000 }, voteStarted: true }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");
    expect(screen.getByText("vote-page")).toBeInTheDocument();
  });
});
