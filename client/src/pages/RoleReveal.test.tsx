import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RoleReveal from "./RoleReveal";

const mockUseRoomSocket = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: mockUseRoomSocket }));

function session(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
    myRole: { roleId: "seer", rolesInPlay: { werewolf: 2, seer: 1, robber: 1, villager: 2 }, wakesAtNight: true },
    roleRevealProgress: { readyPlayerIds: [], totalPlayers: 3 },
    readyForNight: vi.fn(),
    startNight: vi.fn(),
    currentTick: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/room/ABCD/role"]}>
      <Routes>
        <Route path="/room/:roomCode/role" element={<RoleReveal />} />
        <Route path="/room/:roomCode/night" element={<div>night-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RoleReveal", () => {
  beforeEach(() => {
    mockUseRoomSocket.mockReset();
  });

  it("waits for the deal rather than showing an empty card", () => {
    mockUseRoomSocket.mockReturnValue(session({ myRole: null }));
    renderPage();
    expect(screen.getByText(/Distribution des cartes/)).toBeInTheDocument();
  });

  it("names the role, its team, and what this player will be asked to do", () => {
    mockUseRoomSocket.mockReturnValue(session());
    renderPage();

    expect(screen.getByRole("heading", { name: "Voyante" })).toBeInTheDocument();
    expect(screen.getByText("Village")).toBeInTheDocument();
    expect(screen.getByText(/Tu regardes soit la carte d'un joueur/)).toBeInTheDocument();
    expect(screen.getByText(/faire éliminer un Loup-Garou/)).toBeInTheDocument();
  });

  it("tells a sleeping role that it has nothing to do at night", () => {
    mockUseRoomSocket.mockReturnValue(
      session({ myRole: { roleId: "villager", rolesInPlay: { werewolf: 2, villager: 4 }, wakesAtNight: false } }),
    );
    renderPage();

    expect(screen.getByText("Cette nuit, tu dors")).toBeInTheDocument();
    expect(screen.queryByText(/Ton tour arrivera pendant la nuit/)).not.toBeInTheDocument();
  });

  it("lists the whole deck, which is public knowledge", () => {
    mockUseRoomSocket.mockReturnValue(session());
    renderPage();

    expect(screen.getByText("2 × Loup-Garou")).toBeInTheDocument();
    expect(screen.getByText("1 × Voyante")).toBeInTheDocument();
    expect(screen.getByText("Les 6 cartes en jeu")).toBeInTheDocument();
  });

  it("confirms readiness and then reports the table's progress", () => {
    const readyForNight = vi.fn();
    mockUseRoomSocket.mockReturnValue(session({ readyForNight }));
    const { unmount } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "J'ai compris mon rôle" }));
    expect(readyForNight).toHaveBeenCalled();
    unmount();

    mockUseRoomSocket.mockReturnValue(
      session({ roleRevealProgress: { readyPlayerIds: ["p1", "p2"], totalPlayers: 3 } }),
    );
    renderPage();
    expect(screen.getByText("2 / 3 prêts")).toBeInTheDocument();
  });

  it("gives the host, and only the host, a way to start without waiting", () => {
    mockUseRoomSocket.mockReturnValue(
      session({ roleRevealProgress: { readyPlayerIds: ["p1"], totalPlayers: 3 } }),
    );
    const { unmount } = renderPage();
    expect(screen.getByRole("button", { name: "Commencer la nuit maintenant" })).toBeInTheDocument();
    unmount();

    mockUseRoomSocket.mockReturnValue(
      session({ playerId: "p2", roleRevealProgress: { readyPlayerIds: ["p2"], totalPlayers: 3 } }),
    );
    renderPage();
    expect(screen.queryByRole("button", { name: "Commencer la nuit maintenant" })).not.toBeInTheDocument();
  });

  it("follows the room into the night once the first tick fires", () => {
    mockUseRoomSocket.mockReturnValue(
      session({ currentTick: { tickIndex: 0, tickId: "werewolf", durationMs: 15_000, active: false } }),
    );
    renderPage();
    expect(screen.getByText("night-page")).toBeInTheDocument();
  });
});
