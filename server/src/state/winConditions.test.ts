import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { roleTeam, computeWinConditions } from "./winConditions.js";

type TestPlayer = GameState["players"][number];

function player(overrides: Partial<TestPlayer> = {}): TestPlayer {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, reconnectToken: "t1", ...overrides };
}

describe("roleTeam", () => {
  it("groups werewolf and minion into the werewolf team", () => {
    expect(roleTeam("werewolf")).toBe("werewolf");
    expect(roleTeam("minion")).toBe("werewolf");
  });

  it("puts tanner on their own team", () => {
    expect(roleTeam("tanner")).toBe("tanner");
  });

  it("defaults every other role to the village team", () => {
    expect(roleTeam("villager")).toBe("village");
    expect(roleTeam("hunter")).toBe("village");
    expect(roleTeam("seer")).toBe("village");
  });
});

describe("computeWinConditions", () => {
  it("Village wins when a Werewolf is eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "s1", currentRoleId: "seer" }),
    ];
    const result = computeWinConditions(players, {}, ["w1"]);

    expect(result.winningTeam).toBe("village");
    expect(result.winners.sort()).toEqual(["s1", "v1"]);
    expect(result.eliminated).toEqual(["w1"]);
  });

  it("Werewolf team wins when no Werewolf is eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "m1", currentRoleId: "minion" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners.sort()).toEqual(["m1", "w1"]);
  });

  it("only the Minion wins when there are zero Werewolves in the game", () => {
    const players = [
      player({ id: "m1", currentRoleId: "minion" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual(["m1"]);
  });

  it("with no Minion and no Werewolf in the game, the werewolf team has no winners", () => {
    const players = [
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual([]);
  });

  it("the Tanner wins alone if eliminated, even when a Werewolf is also eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "t1", currentRoleId: "tanner" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["w1", "t1"]);

    expect(result.winningTeam).toBe("tanner");
    expect(result.winners).toEqual(["t1"]);
  });

  it("a Tanner who is not eliminated never wins, even if the Tanner team would otherwise win", () => {
    const players = [
      player({ id: "t1", currentRoleId: "tanner" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual([]);
  });

  it("chains a Hunter's death into their vote target's elimination", () => {
    const players = [
      player({ id: "h1", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const votes = { h1: "w1", v1: "h1", w1: "h1" };
    const result = computeWinConditions(players, votes, ["h1"]);

    expect(result.eliminated.sort()).toEqual(["h1", "w1"]);
    expect(result.winningTeam).toBe("village");
  });

  it("does not add a target twice if the Hunter's target is already eliminated", () => {
    const players = [
      player({ id: "h1", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
    ];
    const votes = { h1: "w1" };
    const result = computeWinConditions(players, votes, ["h1", "w1"]);

    expect(result.eliminated.sort()).toEqual(["h1", "w1"]);
  });

  it("chains through two Hunters (Hunter A's shot kills Hunter B, whose shot then fires too)", () => {
    const players = [
      player({ id: "ha", currentRoleId: "hunter" }),
      player({ id: "hb", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
    ];
    const votes = { ha: "hb", hb: "w1" };
    const result = computeWinConditions(players, votes, ["ha"]);

    expect(result.eliminated.sort()).toEqual(["ha", "hb", "w1"]);
    expect(result.winningTeam).toBe("village");
  });
});
