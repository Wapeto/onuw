import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RoleSelect from "./RoleSelect";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/roles" element={<RoleSelect />} />
        <Route path="/room/:roomCode/night" element={<div>night-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCDE",
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
    roleSelection: {
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      valid: true,
    },
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

describe("RoleSelect", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
  });

  it("shows a loading state while roleSelection hasn't arrived yet", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ roleSelection: null }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();
  });

  it("shows mode buttons to the host", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.getByRole("button", { name: /classique/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /simple/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /personnalisé/i })).toBeInTheDocument();
  });

  it("hides mode buttons and the launch button from non-host players", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ playerId: "p2" }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.queryByRole("button", { name: /classique/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });

  it("calls setRoleMode when the host clicks a mode button", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("button", { name: /personnalisé/i }));
    expect(session.setRoleMode).toHaveBeenCalledWith("custom");
  });

  it("shows the recap and the running total", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText("2 × Loup-Garou")).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 6/)).toBeInTheDocument();
  });

  it("in custom mode, lets the host increment a role and calls setCustomRoles", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");

    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    expect(session.setCustomRoles).toHaveBeenCalled();
  });

  it("toggles mason straight from 0 to 2 on increment", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, mason: 0, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const masonRow = screen.getByText("Franc-Maçon").closest("li")!;
    const { getByRole } = within(masonRow);
    fireEvent.click(getByRole("button", { name: "+" }));
    expect(session.setCustomRoles).toHaveBeenCalledWith(
      expect.objectContaining({ mason: 2 }),
    );
  });

  it("toggles mason straight from 2 to 0 on decrement", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, mason: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const masonRow = screen.getByText("Franc-Maçon").closest("li")!;
    const { getByRole } = within(masonRow);
    fireEvent.click(getByRole("button", { name: "-" }));
    expect(session.setCustomRoles).toHaveBeenCalledWith(
      expect.objectContaining({ mason: 0 }),
    );
  });

  it("hides the custom role checklist from the host in classic mode", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();
  });

  it("disables incrementing werewolf past 2", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const werewolfRow = screen.getByText("Loup-Garou").closest("li")!;
    const { getByRole } = within(werewolfRow);
    expect(getByRole("button", { name: "+" })).toBeDisabled();
  });

  it("disables incrementing insomniac when robber and troublemaker are both absent", () => {
    // total (4) is deliberately below target (6) so isFull is false — the button
    // must be disabled specifically because of the insomniac compat rule, not
    // because the selection happens to be full.
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 2 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const insomniacRow = screen.getByText("Insomniaque").closest("li")!;
    const { getByRole } = within(insomniacRow);
    expect(getByRole("button", { name: "+" })).toBeDisabled();
  });

  it("disables the launch button while the selection is invalid", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeDisabled();
  });

  it("calls startGame when the host clicks Lancer with a valid selection", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("button", { name: /lancer/i }));
    expect(session.startGame).toHaveBeenCalled();
  });

  it("navigates to the night page once currentTick is set", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText("night-page")).toBeInTheDocument();
  });

  it("lets the host change the day duration and shows it to everyone", () => {
    const setDayDuration = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ dayDurationMs: 240_000, setDayDuration }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");

    const input = screen.getByLabelText(/durée de la discussion/i) as HTMLInputElement;
    expect(input.value).toBe("4");

    fireEvent.change(input, { target: { value: "2" } });
    expect(setDayDuration).toHaveBeenCalledWith(120_000);
  });

  it("hides the day duration control from non-hosts but still shows the value", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        dayDurationMs: 300_000,
        players: [
          { id: "p1", pseudo: "Alice", isHost: true, connected: true },
          { id: "p2", pseudo: "Bob", isHost: false, connected: true },
        ],
        playerId: "p2",
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");

    expect(screen.queryByLabelText(/durée de la discussion/i)).not.toBeInTheDocument();
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
  });
});
