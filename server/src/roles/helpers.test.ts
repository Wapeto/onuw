import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { requireOriginalRole } from "./helpers.js";

function player(overrides: Partial<GameState["players"][number]> = {}): GameState["players"][number] {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, reconnectToken: "t1", ...overrides };
}

describe("requireOriginalRole", () => {
  it("returns the player's originalRoleId when set", () => {
    expect(requireOriginalRole(player({ originalRoleId: "seer" }))).toBe("seer");
  });

  it("throws when originalRoleId is unset", () => {
    expect(() => requireOriginalRole(player())).toThrow(/no assigned role/);
  });
});
