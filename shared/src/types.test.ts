import { describe, it, expect } from "vitest";
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
