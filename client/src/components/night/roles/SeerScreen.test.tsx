import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import SeerScreen from "./SeerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

describe("SeerScreen", () => {
  it("submits a player-mode look on pick", async () => {
    const onSubmit = vi.fn();
    render(<SeerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Bob" }));
    expect(onSubmit).toHaveBeenCalledWith({ mode: "player", targetPlayerId: "p2" });
  });

  it("submits a center-mode look after picking exactly two cards", async () => {
    const onSubmit = vi.fn();
    render(<SeerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Voir 2 cartes du centre" }));
    await userEvent.click(screen.getByRole("button", { name: "Carte 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Carte 3" }));

    expect(onSubmit).toHaveBeenCalledWith({ mode: "center", centerIndices: [0, 2] });
  });

  it("reveals the result once it arrives", () => {
    render(
      <SeerScreen playerId="p1" players={players} result={{ roleId: "werewolf" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Loup-Garou/)).toBeInTheDocument();
  });
});
