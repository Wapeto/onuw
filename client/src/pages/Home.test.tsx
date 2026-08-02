import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Home from "./Home";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession() {
  return {
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
    dayDurationMs: 240_000,
    daySession: null,
    voteStarted: false,
    voteResult: null,
    setDayDuration: vi.fn(),
    submitVote: vi.fn(),
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession());
  });

  it("disables both action buttons until a pseudo is entered", () => {
    renderAt("/");
    expect(screen.getByRole("button", { name: /créer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rejoindre/i })).toBeDisabled();
  });

  it("calls createRoom with the entered pseudo", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session);
    renderAt("/");

    fireEvent.change(screen.getByLabelText(/pseudo/i), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: /créer/i }));

    expect(session.createRoom).toHaveBeenCalledWith("Alice");
  });

  it("calls joinRoom with the entered pseudo and code", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session);
    renderAt("/");

    fireEvent.change(screen.getByLabelText(/pseudo/i), { target: { value: "Bob" } });
    fireEvent.change(screen.getByPlaceholderText(/code/i), { target: { value: "abcde" } });
    fireEvent.click(screen.getByRole("button", { name: /rejoindre/i }));

    expect(session.joinRoom).toHaveBeenCalledWith("ABCDE", "Bob");
  });

  it("prefills the join code from a /join/:code route", () => {
    renderAt("/join/wxyz1");
    expect(screen.getByPlaceholderText(/code/i)).toHaveValue("WXYZ1");
  });

  it("shows a ROOM_ERROR message when present", () => {
    vi.mocked(useRoomSocket).mockReturnValue({ ...baseSession(), error: "room not found" });
    renderAt("/");
    expect(screen.getByRole("alert")).toHaveTextContent("room not found");
  });
});
