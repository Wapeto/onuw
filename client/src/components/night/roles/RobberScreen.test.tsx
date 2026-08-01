import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import RobberScreen from "./RobberScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("excludes self from the target list and submits on pick", async () => {
  const onSubmit = vi.fn();
  render(<RobberScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "Alice" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2" });
});

it("reveals the new role once the result arrives", () => {
  render(
    <RobberScreen playerId="p1" players={players} result={{ newRoleId: "villager" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});
