import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Night from "./Night";

const mockUseRoomSocket = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: mockUseRoomSocket }));
vi.mock("../hooks/useFullscreen", () => ({ useFullscreen: vi.fn() }));

function renderNight() {
  return render(
    <MemoryRouter initialEntries={["/room/ABCD/night"]}>
      <Routes>
        <Route path="/room/:roomCode/night" element={<Night />} />
        <Route path="/room/:roomCode/day" element={<div>day-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Night", () => {
  beforeEach(() => {
    mockUseRoomSocket.mockReset();
  });

  it("gives a sleeping player a dream that mirrors the acting screen", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      ],
      currentTick: { tickIndex: 0, tickId: "robber", durationMs: 8000, active: false, tickNumber: 1, tickCount: 4 },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    // Same gesture the real Voleur is making right now — a player grid — so
    // a glance across the table can't tell the two screens apart.
    expect(screen.getByText(/tu tends la main/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bob" })).toBeInTheDocument();
  });

  it("never submits anything a sleeping player taps", () => {
    const submitNightAction = vi.fn();
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      ],
      currentTick: { tickIndex: 0, tickId: "robber", durationMs: 8000, active: false, tickNumber: 1, tickCount: 4 },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction,
      daySession: null,
    });

    vi.useFakeTimers();
    try {
      renderNight();
      fireEvent.click(screen.getByRole("button", { name: "Bob" }));

      expect(submitNightAction).not.toHaveBeenCalled();
      // The unveil is held back by the same beat a real action spends
      // waiting on the server, so the two screens resolve in step.
      expect(screen.queryByRole("button", { name: "J'ai vu" })).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("button", { name: "J'ai vu" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the same night bar whether or not this player is acting", () => {
    const tick = { tickIndex: 2, tickId: "seer" as const, durationMs: 25_000, tickNumber: 3, tickCount: 4 };
    const base = {
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    };

    mockUseRoomSocket.mockReturnValue({ ...base, currentTick: { ...tick, active: false } });
    const asleep = renderNight();
    expect(screen.getByText("Nuit · 3/4")).toBeInTheDocument();
    expect(screen.getByText("La Voyante")).toBeInTheDocument();
    asleep.unmount();

    mockUseRoomSocket.mockReturnValue({ ...base, currentTick: { ...tick, active: true } });
    renderNight();
    expect(screen.getByText("Nuit · 3/4")).toBeInTheDocument();
    expect(screen.getByText("La Voyante")).toBeInTheDocument();
  });

  it("shows the matching role screen when active", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "robber", durationMs: 8000, active: true, tickNumber: 1, tickCount: 4 },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    expect(screen.getByText(/Échange ta carte avec/)).toBeInTheDocument();
  });

  it("shows a neutral pause overlay without revealing who disconnected", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false, tickNumber: 1, tickCount: 4 },
      nightPaused: true,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    expect(screen.getByText(/en pause/)).toBeInTheDocument();
    expect(screen.queryByText("La Voyante")).not.toBeInTheDocument();
  });

  it("shows the end-of-night text once NIGHT_END fires", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: null,
      nightPaused: false,
      nightEnded: true,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    expect(screen.getByText(/nuit est terminée/)).toBeInTheDocument();
  });

  it("navigates to the day page once daySession is set", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: null,
      nightPaused: false,
      nightEnded: true,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: { durationMs: 240_000 },
    });

    renderNight();
    expect(screen.getByText("day-page")).toBeInTheDocument();
  });
});
