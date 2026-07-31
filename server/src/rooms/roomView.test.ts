import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { toPublicPlayers } from "./roomView.js";

function fixture(phase: GameState["phase"]): GameState {
  return {
    roomCode: "ABCD",
    phase,
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, originalRoleId: "seer", currentRoleId: "seer" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: false },
    ],
    center: [],
    night: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("toPublicPlayers", () => {
  it("passes through real connected state outside of NIGHT", () => {
    const players = toPublicPlayers(fixture("LOBBY"));
    expect(players).toEqual([
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: false },
    ]);
  });

  it("masks connected to null during NIGHT", () => {
    const players = toPublicPlayers(fixture("NIGHT"));
    expect(players.every((p) => p.connected === null)).toBe(true);
  });

  it("never includes role fields, in any phase", () => {
    const players = toPublicPlayers(fixture("NIGHT"));
    expect(players[0]).not.toHaveProperty("originalRoleId");
    expect(players[0]).not.toHaveProperty("currentRoleId");
  });
});
