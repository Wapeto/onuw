import { describe, it, expect } from "vitest";
import type { GameState, Player } from "@onuw/shared";
import {
  werewolfResolver,
  minionResolver,
  masonResolver,
  seerResolver,
  insomniacResolver,
} from "./actionResolvers.js";

function player(overrides: Partial<Player>): Player {
  return { id: overrides.id ?? "p1", pseudo: "x", isHost: false, connected: true, ...overrides };
}

function stateWith(players: Player[], center: GameState["center"] = []): GameState {
  return { roomCode: "ABCD", phase: "NIGHT", players, center, night: null, createdAt: 0, updatedAt: 0 };
}

describe("werewolfResolver", () => {
  it("returns teammate ids for a two-wolf game", () => {
    const wolf1 = player({ id: "w1", currentRoleId: "werewolf" });
    const wolf2 = player({ id: "w2", currentRoleId: "werewolf" });
    const state = stateWith([wolf1, wolf2]);
    const { result } = werewolfResolver("w1", state, {});
    expect(result).toEqual({ teammateIds: ["w2"] });
  });

  it("returns a center card for a lone wolf", () => {
    const wolf = player({ id: "w1", currentRoleId: "werewolf" });
    const state = stateWith([wolf], ["seer", "villager", "tanner"]);
    const { result } = werewolfResolver("w1", state, { centerIndex: 0 });
    expect(result).toEqual({ centerRoleId: "seer" });
  });
});

describe("minionResolver", () => {
  it("returns the ids of all current werewolves", () => {
    const minion = player({ id: "m1", currentRoleId: "minion" });
    const wolf = player({ id: "w1", currentRoleId: "werewolf" });
    const { result } = minionResolver("m1", stateWith([minion, wolf]), {});
    expect(result).toEqual({ werewolfIds: ["w1"] });
  });
});

describe("masonResolver", () => {
  it("returns the ids of the other masons", () => {
    const mason1 = player({ id: "m1", currentRoleId: "mason" });
    const mason2 = player({ id: "m2", currentRoleId: "mason" });
    const { result } = masonResolver("m1", stateWith([mason1, mason2]), {});
    expect(result).toEqual({ masonIds: ["m2"] });
  });
});

describe("seerResolver", () => {
  it("views a player's current role", () => {
    const seer = player({ id: "s1", currentRoleId: "seer" });
    const target = player({ id: "t1", currentRoleId: "villager" });
    const { result } = seerResolver("s1", stateWith([seer, target]), {
      mode: "player",
      targetPlayerId: "t1",
    });
    expect(result).toEqual({ roleId: "villager" });
  });

  it("views two center cards", () => {
    const seer = player({ id: "s1", currentRoleId: "seer" });
    const state = stateWith([seer], ["tanner", "hunter", "villager"]);
    const { result } = seerResolver("s1", state, { mode: "center", centerIndices: [0, 1] });
    expect(result).toEqual({ roleIds: ["tanner", "hunter"] });
  });
});

describe("insomniacResolver", () => {
  it("views the acting player's own current role", () => {
    const insomniac = player({ id: "i1", currentRoleId: "robber" });
    const { result } = insomniacResolver("i1", stateWith([insomniac]), {});
    expect(result).toEqual({ roleId: "robber" });
  });
});

import { robberResolver, troublemakerResolver, drunkResolver } from "./actionResolvers.js";

describe("robberResolver", () => {
  it("swaps roles with the target and reveals the new role", () => {
    const robber = player({ id: "r1", currentRoleId: "robber" });
    const target = player({ id: "t1", currentRoleId: "villager" });
    const { gameState, result } = robberResolver("r1", stateWith([robber, target]), {
      targetPlayerId: "t1",
    });
    expect(gameState.players.find((p) => p.id === "r1")?.currentRoleId).toBe("villager");
    expect(gameState.players.find((p) => p.id === "t1")?.currentRoleId).toBe("robber");
    expect(result).toEqual({ newRoleId: "villager" });
  });
});

describe("troublemakerResolver", () => {
  it("swaps two other players' roles without revealing anything", () => {
    const troublemaker = player({ id: "tm1", currentRoleId: "troublemaker" });
    const a = player({ id: "a1", currentRoleId: "villager" });
    const b = player({ id: "b1", currentRoleId: "seer" });
    const { gameState, result } = troublemakerResolver("tm1", stateWith([troublemaker, a, b]), {
      targetAId: "a1",
      targetBId: "b1",
    });
    expect(gameState.players.find((p) => p.id === "a1")?.currentRoleId).toBe("seer");
    expect(gameState.players.find((p) => p.id === "b1")?.currentRoleId).toBe("villager");
    expect(result).toEqual({});
  });
});

describe("drunkResolver", () => {
  it("swaps the drunk's role with a center card without revealing it", () => {
    const drunk = player({ id: "d1", currentRoleId: "drunk" });
    const state = stateWith([drunk], ["hunter", "villager", "tanner"]);
    const { gameState, result } = drunkResolver("d1", state, { centerIndex: 1 });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("villager");
    expect(gameState.center[1]).toBe("drunk");
    expect(result).toEqual({});
  });
});
