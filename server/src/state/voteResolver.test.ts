import { describe, it, expect } from "vitest";
import { resolveVotes } from "./voteResolver.js";

describe("resolveVotes", () => {
  it("eliminates the single player with the most votes", () => {
    const result = resolveVotes({ p1: "p2", p2: "p2", p3: "p1" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 1, p2: 2, p3: 0 });
    expect(result.eliminated).toEqual(["p2"]);
  });

  it("eliminates every player tied for the most votes", () => {
    const result = resolveVotes({ p1: "p2", p2: "p1", p3: "p1" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 2, p2: 1, p3: 0 });
    expect(result.eliminated).toEqual(["p1"]);
  });

  it("eliminates a 2-way tie for the max", () => {
    const result = resolveVotes({ p1: "p2", p2: "p1" }, ["p1", "p2"]);
    expect(result.tally).toEqual({ p1: 1, p2: 1 });
    expect(result.eliminated.sort()).toEqual(["p1", "p2"]);
  });

  it("includes every player id in the tally even with zero votes", () => {
    const result = resolveVotes({ p1: "p2" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 0, p2: 1, p3: 0 });
  });

  it("returns no eliminations when there are no votes at all", () => {
    const result = resolveVotes({}, ["p1", "p2"]);
    expect(result.tally).toEqual({ p1: 0, p2: 0 });
    expect(result.eliminated).toEqual([]);
  });
});
