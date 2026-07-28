import { describe, it, expect } from "vitest";
import type { GameState, Player } from "@onuw/shared";
import { NIGHT_ORDER } from "./nightOrder.js";

function player(overrides: Partial<Player>): Player {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, ...overrides };
}

function stateWith(players: Player[]): GameState {
  return {
    roomCode: "ABCD",
    phase: "NIGHT",
    players,
    center: [],
    night: {
      tickIndex: 0,
      tickStartedAt: 0,
      durationMs: 0,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("NIGHT_ORDER", () => {
  it("has exactly 10 ticks in the official + 9a order", () => {
    expect(NIGHT_ORDER.map((t) => t.tickId)).toEqual([
      "doppelganger",
      "werewolf",
      "minion",
      "mason",
      "seer",
      "robber",
      "troublemaker",
      "drunk",
      "insomniac",
      "doppelgangerInsomniac",
    ]);
  });

  it("werewolf tick includes a doppelganger who copied werewolf", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "werewolf")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "werewolf" });
    const state: GameState = {
      ...stateWith([p]),
      night: { ...stateWith([]).night!, doppelgangerCopiedRoleId: "werewolf" },
    };
    expect(tick.activeFor(p, state)).toBe(true);
  });

  it("werewolf tick includes a genuine werewolf even after their card was swapped away", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "werewolf")!;
    const p = player({ originalRoleId: "werewolf", currentRoleId: "doppelganger" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(true);
  });

  it("insomniac tick includes a genuine insomniac even after their card was robbed away (base-game, no Doppelganger)", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "insomniac")!;
    const p = player({ originalRoleId: "insomniac", currentRoleId: "robber" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(true);
  });

  it("robber tick excludes a doppelganger who already copied robber", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "robber")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "robber" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(false);
  });

  it("robber tick includes a genuine robber", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "robber")!;
    const p = player({ originalRoleId: "robber", currentRoleId: "robber" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(true);
  });

  it("insomniac tick excludes a doppelganger who copied insomniac", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "insomniac")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "insomniac" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(false);
  });

  it("doppelgangerInsomniac tick includes only a doppelganger who copied insomniac", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "doppelgangerInsomniac")!;
    const dopp = player({ id: "d1", originalRoleId: "doppelganger", currentRoleId: "insomniac" });
    const genuine = player({ id: "i1", originalRoleId: "insomniac", currentRoleId: "insomniac" });
    const state: GameState = {
      ...stateWith([dopp, genuine]),
      night: {
        ...stateWith([]).night!,
        doppelgangerCopiedRoleId: "insomniac",
        doppelgangerCopiedPlayerId: "d1",
      },
    };
    expect(tick.activeFor(dopp, state)).toBe(true);
    expect(tick.activeFor(genuine, state)).toBe(false);
  });
});
