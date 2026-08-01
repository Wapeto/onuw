import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import MinionScreen from "./MinionScreen";
import MasonScreen from "./MasonScreen";
import InsomniacScreen from "./InsomniacScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

describe("MinionScreen", () => {
  it("auto-submits on mount and shows werewolf names once the result arrives", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <MinionScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
    );
    expect(onSubmit).toHaveBeenCalledWith({});

    rerender(
      <MinionScreen playerId="p1" players={players} result={{ werewolfIds: ["p2"] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it("says there is no werewolf when the list is empty", () => {
    render(
      <MinionScreen playerId="p1" players={players} result={{ werewolfIds: [] }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/pas de Loup-Garou/)).toBeInTheDocument();
  });
});

describe("MasonScreen", () => {
  it("shows the other mason's name", () => {
    render(
      <MasonScreen playerId="p1" players={players} result={{ masonIds: ["p2"] }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });
});

describe("InsomniacScreen", () => {
  it("shows the player's own current role", () => {
    render(
      <InsomniacScreen playerId="p1" players={players} result={{ roleId: "werewolf" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Loup-Garou/)).toBeInTheDocument();
  });

  it("continuing calls onContinue", async () => {
    const onContinue = vi.fn();
    render(
      <InsomniacScreen playerId="p1" players={players} result={{ roleId: "villager" }} onSubmit={vi.fn()} onContinue={onContinue} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "J'ai vu" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
