import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import TroublemakerScreen from "./TroublemakerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
  { id: "p3", pseudo: "Cy", isHost: false, connected: true },
];

describe("TroublemakerScreen", () => {
  it("picks two distinct other players, excluding self, then submits", async () => {
    const onSubmit = vi.fn();
    render(
      <TroublemakerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "Alice" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bob" }));
    await userEvent.click(screen.getByRole("button", { name: "Cy" }));

    expect(onSubmit).toHaveBeenCalledWith({ targetAId: "p2", targetBId: "p3" });
  });

  it("shows a blind confirmation once the result arrives (Troublemaker never sees the swapped roles)", () => {
    render(
      <TroublemakerScreen playerId="p1" players={players} result={{}} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/échangées/)).toBeInTheDocument();
  });
});
