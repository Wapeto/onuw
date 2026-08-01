import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import DoppelgangerScreen from "./DoppelgangerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

const threePlayers: PublicPlayer[] = [...players, { id: "p3", pseudo: "Carol", isHost: false, connected: true }];

it("submits a target pick with no subParams", async () => {
  const onSubmit = vi.fn();
  render(<DoppelgangerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2" });
});

it("for a passive copied role, reveals immediately with no sub-action", () => {
  render(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "villager" }}
      onSubmit={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});

it("for a chain-eligible copied role, offers the sub-action UI after a real phase-1 pick, then submits phase-2 subParams", async () => {
  const onSubmit = vi.fn();
  const { rerender } = render(
    <DoppelgangerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2" });

  rerender(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "robber" }}
      onSubmit={onSubmit}
      onContinue={vi.fn()}
    />,
  );

  expect(screen.getByText(/Voleur/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bob" }));

  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } });
});

it("shows the chained reveal once it arrives, after a real phase-1 pick", async () => {
  const onSubmit = vi.fn();
  const { rerender } = render(
    <DoppelgangerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));

  rerender(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "robber", chained: { newRoleId: "villager" } }}
      onSubmit={onSubmit}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});

it("chains into MinionScreen for a copied Minion role: auto-submits phase-2 subParams, then reveals werewolf names", async () => {
  const onSubmit = vi.fn();
  const { rerender } = render(
    <DoppelgangerScreen playerId="p1" players={threePlayers} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  onSubmit.mockClear();

  rerender(
    <DoppelgangerScreen
      playerId="p1"
      players={threePlayers}
      result={{ copiedRoleId: "minion" }}
      onSubmit={onSubmit}
      onContinue={vi.fn()}
    />,
  );

  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2", subParams: {} });

  rerender(
    <DoppelgangerScreen
      playerId="p1"
      players={threePlayers}
      result={{ copiedRoleId: "minion", chained: { werewolfIds: ["p3"] } }}
      onSubmit={onSubmit}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Carol/)).toBeInTheDocument();
});
