import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { canTransition, transition } from "./phases.js";

const base: GameState = {
  roomCode: "ABCD",
  phase: "LOBBY",
  players: [],
  center: [],
  night: null,
  roleSelection: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("canTransition", () => {
  it.each([
    ["LOBBY", "ROLE_SELECT"],
    ["ROLE_SELECT", "NIGHT"],
    ["ROLE_SELECT", "LOBBY"],
    ["NIGHT", "DAY"],
    ["DAY", "VOTE"],
    ["VOTE", "REVEAL"],
    ["REVEAL", "ROLE_SELECT"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["LOBBY", "NIGHT"],
    ["NIGHT", "LOBBY"],
    ["DAY", "REVEAL"],
    ["REVEAL", "LOBBY"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("transition", () => {
  it("returns a new state with the updated phase and timestamp", () => {
    const next = transition({ ...base, phase: "LOBBY" }, "ROLE_SELECT");
    expect(next.phase).toBe("ROLE_SELECT");
    expect(next).not.toBe(base);
  });

  it("throws on an invalid transition", () => {
    expect(() => transition({ ...base, phase: "LOBBY" }, "NIGHT")).toThrow(
      /invalid phase transition/,
    );
  });
});
