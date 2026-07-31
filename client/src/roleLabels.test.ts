import { describe, it, expect } from "vitest";
import { ROLE_IDS } from "@onuw/shared";
import { roleLabel } from "./roleLabels";

describe("roleLabel", () => {
  it("has a non-empty French label for every RoleId", () => {
    for (const id of ROLE_IDS) {
      expect(roleLabel(id).length).toBeGreaterThan(0);
    }
  });

  it("labels werewolf and seer as expected", () => {
    expect(roleLabel("werewolf")).toBe("Loup-Garou");
    expect(roleLabel("seer")).toBe("Voyante");
  });
});
