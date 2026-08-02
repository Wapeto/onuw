import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("shows DummyScreen when the current tick isn't active for this player", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    expect(screen.getByText("Continuer à dormir")).toBeInTheDocument();
  });

  it("shows the matching role screen when active", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "robber", durationMs: 8000, active: true },
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
      currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      nightPaused: true,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: null,
    });

    renderNight();
    expect(screen.getByText(/en pause/)).toBeInTheDocument();
    expect(screen.queryByText("Continuer à dormir")).not.toBeInTheDocument();
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
