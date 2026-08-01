import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import WerewolfScreen from "./WerewolfScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("auto-submits on mount and shows the teammate when present", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(
    <WerewolfScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(onSubmit).toHaveBeenCalledWith({});

  rerender(
    <WerewolfScreen playerId="p1" players={players} result={{ teammateIds: ["p2"] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Bob/)).toBeInTheDocument();
});

it("offers a 3-card center chooser when alone, and submits centerIndex on pick", async () => {
  const onSubmit = vi.fn();
  render(
    <WerewolfScreen playerId="p1" players={players} result={{ teammateIds: [] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/aucun autre Loup/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Carte 2" }));
  expect(onSubmit).toHaveBeenCalledWith({ centerIndex: 1 });
});

it("reveals the peeked center card once it comes back", () => {
  render(
    <WerewolfScreen playerId="p1" players={players} result={{ centerRoleId: "tanner" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Tanneur/)).toBeInTheDocument();
});
