import { describe, it, expect } from "vitest";
import { generateRoomCode } from "./roomCode.js";

describe("generateRoomCode", () => {
  it("generates a 5-character code from the confusable-free alphabet", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it("generates different codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
