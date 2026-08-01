import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import DoppelgangerScreen from "./DoppelgangerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

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

it("for a chain-eligible copied role, offers the sub-action UI, then submits phase-2 subParams", async () => {
  const onSubmit = vi.fn();
  render(
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

it("shows the chained reveal once it arrives", () => {
  render(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "robber", chained: { newRoleId: "villager" } }}
      onSubmit={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});
