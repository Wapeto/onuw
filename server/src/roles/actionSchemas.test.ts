import { describe, it, expect } from "vitest";
import { actionParamsSchemas } from "./actionSchemas.js";

describe("actionParamsSchemas", () => {
  it("accepts a valid seer center-mode payload and rejects a malformed one", () => {
    const schema = actionParamsSchemas.seer;
    expect(schema.safeParse({ mode: "center", centerIndices: [0, 1] }).success).toBe(true);
    expect(schema.safeParse({ mode: "center", centerIndices: [0] }).success).toBe(false);
    expect(schema.safeParse({ mode: "player" }).success).toBe(false);
  });

  it("accepts an empty object for no-param ticks (minion, mason, insomniac, doppelgangerInsomniac)", () => {
    expect(actionParamsSchemas.minion.safeParse({}).success).toBe(true);
    expect(actionParamsSchemas.mason.safeParse({}).success).toBe(true);
  });

  it("rejects an out-of-range drunk centerIndex", () => {
    expect(actionParamsSchemas.drunk.safeParse({ centerIndex: 3 }).success).toBe(false);
    expect(actionParamsSchemas.drunk.safeParse({ centerIndex: 1 }).success).toBe(true);
  });
});
