import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { DEFAULT_DAY_DURATION_MS } from "@onuw/shared";
import { isRoleSelectionValid, assignRoles } from "./presetValidation.js";

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode: "ABCD",
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true, reconnectToken: "t3" },
    ],
    center: [],
    night: null,
    roleSelection: null,
    createdAt: 0,
    updatedAt: 0,
    day: null,
    vote: null,
    reveal: null,
    lastRoleSelection: null,
    dayDurationMs: DEFAULT_DAY_DURATION_MS,
    ...overrides,
  };
}

describe("isRoleSelectionValid", () => {
  it("is false when there is no selection yet", () => {
    expect(isRoleSelectionValid(baseState())).toBe(false);
  });

  it("is true for a valid classic selection matching player count", () => {
    const state = baseState({
      roleSelection: {
        mode: "classic",
        roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      },
    });
    expect(isRoleSelectionValid(state)).toBe(true);
  });

  it("is false when the total doesn't match player count + 3", () => {
    const state = baseState({ roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 } } });
    expect(isRoleSelectionValid(state)).toBe(false);
  });
});

describe("assignRoles", () => {
  it("throws when the current selection is invalid", () => {
    const state = baseState({ roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 } } });
    expect(() => assignRoles(state)).toThrow();
  });

  it("deals a deterministic shuffle to players and center, and clears roleSelection", () => {
    const state = baseState({
      roleSelection: {
        mode: "classic",
        roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      },
    });

    // random() always returning 0 makes Fisher-Yates fully deterministic: every
    // iteration swaps the current tail element with index 0. Flattened deck in
    // ROLE_IDS order is [werewolf, werewolf, seer, robber, troublemaker, villager];
    // tracing the swaps by hand gives this exact final order.
    const result = assignRoles(state, () => 0);

    expect(result.players.map((p) => p.currentRoleId)).toEqual(["werewolf", "seer", "robber"]);
    expect(result.players.map((p) => p.originalRoleId)).toEqual(["werewolf", "seer", "robber"]);
    expect(result.center).toEqual(["troublemaker", "villager", "werewolf"]);
    expect(result.roleSelection).toBeNull();
  });

  it("always deals exactly 3 cards to the center regardless of player count", () => {
    const state = baseState({
      roleSelection: { mode: "simple", roles: { werewolf: 2, villager: 4 } },
    });
    const result = assignRoles(state, () => 0.5);
    expect(result.center).toHaveLength(3);
    expect(result.players.every((p) => p.currentRoleId !== undefined)).toBe(true);
  });

  it("stashes the role selection used for this game as lastRoleSelection, for a future Replayer", () => {
    const roleSelection = {
      mode: "classic" as const,
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
    };
    const state = baseState({ roleSelection });

    const result = assignRoles(state, () => 0);

    expect(result.roleSelection).toBeNull();
    expect(result.lastRoleSelection).toEqual(roleSelection);
  });
});
