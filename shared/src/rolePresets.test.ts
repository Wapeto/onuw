import { describe, it, expect } from "vitest";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildClassicPreset,
  buildSimplePreset,
  totalRoleCount,
  flattenRoleCounts,
  validateRoleSelection,
} from "./rolePresets";

describe("buildClassicPreset", () => {
  it("matches the official 3-player rulebook composition", () => {
    expect(buildClassicPreset(3)).toEqual({
      werewolf: 2,
      seer: 1,
      robber: 1,
      troublemaker: 1,
      villager: 1,
    });
  });

  it("matches the official 5-player rulebook composition (3 villagers)", () => {
    const preset = buildClassicPreset(5);
    expect(preset.villager).toBe(3);
    expect(totalRoleCount(preset)).toBe(8);
  });

  it("pairs masons and lands on N+3 for the corrected 10-player extrapolation", () => {
    const preset = buildClassicPreset(10);
    expect(preset.mason).toBe(2);
    expect(totalRoleCount(preset)).toBe(13);
  });

  it("totals N+3 for every supported player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(totalRoleCount(buildClassicPreset(n))).toBe(n + 3);
    }
  });

  it("throws outside the 3-10 player range", () => {
    expect(() => buildClassicPreset(2)).toThrow();
    expect(() => buildClassicPreset(11)).toThrow();
  });
});

describe("buildSimplePreset", () => {
  it("is always exactly 2 werewolves and N+1 villagers, nothing else", () => {
    const preset = buildSimplePreset(6);
    expect(preset).toEqual({ werewolf: 2, villager: 7 });
    expect(totalRoleCount(preset)).toBe(9);
  });

  it("totals N+3 for every supported player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(totalRoleCount(buildSimplePreset(n))).toBe(n + 3);
    }
  });
});

describe("flattenRoleCounts", () => {
  it("expands counts into a flat RoleId array in ROLE_IDS order", () => {
    const flat = flattenRoleCounts({ werewolf: 2, villager: 1 });
    expect(flat).toEqual(["werewolf", "werewolf", "villager"]);
  });

  it("round-trips through totalRoleCount as the array length", () => {
    const roles = buildClassicPreset(7);
    expect(flattenRoleCounts(roles)).toHaveLength(totalRoleCount(roles));
  });
});

describe("validateRoleSelection", () => {
  it("accepts every classic preset as valid for its own player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const result = validateRoleSelection("classic", n, buildClassicPreset(n));
      expect(result).toEqual({ valid: true, errors: [] });
    }
  });

  it("accepts every simple preset as valid for its own player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(validateRoleSelection("simple", n, buildSimplePreset(n)).valid).toBe(true);
    }
  });

  it("rejects a total that doesn't equal playerCount + 3", () => {
    const result = validateRoleSelection("custom", 5, { werewolf: 2, villager: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("8"))).toBe(true);
  });

  it("rejects a single mason (masons must be 0 or 2)", () => {
    const result = validateRoleSelection("custom", 5, {
      werewolf: 2, seer: 1, robber: 1, mason: 1, villager: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("maçon"))).toBe(true);
  });

  it("rejects insomniac without robber or troublemaker in the selection", () => {
    const result = validateRoleSelection("custom", 6, {
      werewolf: 2, seer: 1, insomniac: 1, villager: 5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("insomniaque"))).toBe(true);
  });

  it("accepts insomniac when robber is present", () => {
    const result = validateRoleSelection("custom", 6, {
      werewolf: 2, robber: 1, insomniac: 1, villager: 5,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects doppelganger in classic or simple mode", () => {
    const asClassic = validateRoleSelection("classic", 5, { werewolf: 2, doppelganger: 1, villager: 5 });
    expect(asClassic.valid).toBe(false);
    expect(asClassic.errors.some((e) => e.includes("doppelganger"))).toBe(true);
  });

  it("accepts doppelganger and villageIdiot in custom mode", () => {
    const result = validateRoleSelection("custom", 5, {
      werewolf: 2, doppelganger: 1, villageIdiot: 1, villager: 4,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a second copy of a singleton role like seer", () => {
    const result = validateRoleSelection("custom", 5, { werewolf: 2, seer: 2, villager: 4 });
    expect(result.valid).toBe(false);
  });

  it("rejects a player count outside 3-10", () => {
    const result = validateRoleSelection("custom", 2, { werewolf: 2, villager: 3 });
    expect(result.valid).toBe(false);
  });
});
