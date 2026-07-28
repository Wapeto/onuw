import { describe, it, expect } from "vitest";
import type { GameState, NightState, Player } from "./types";
import { ROLE_IDS, isValidRoleId } from "./types";

describe("isValidRoleId", () => {
  it("pins the total number of roles", () => {
    expect(ROLE_IDS).toHaveLength(13);
  });

  it("accepts every id in ROLE_IDS", () => {
    for (const id of ROLE_IDS) {
      expect(isValidRoleId(id)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isValidRoleId("wizard")).toBe(false);
  });
});

describe("GameState shape", () => {
  it("allows a full night-in-progress state", () => {
    const night: NightState = {
      tickIndex: 2,
      tickStartedAt: 1000,
      durationMs: 7000,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    };
    const player: Player = {
      id: "p1",
      pseudo: "Alice",
      isHost: true,
      connected: true,
      originalRoleId: "seer",
      currentRoleId: "seer",
    };
    const state: GameState = {
      roomCode: "ABCD",
      phase: "NIGHT",
      players: [player],
      center: ["villager", "villager", "tanner"],
      night,
      createdAt: 500,
      updatedAt: 1000,
    };

    expect(state.night?.tickIndex).toBe(2);
    expect(state.players[0].currentRoleId).toBe("seer");
  });
});
