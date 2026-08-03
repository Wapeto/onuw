import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

describe("createRateLimiter", () => {
  it("allows up to `capacity` consumptions with no time passing", () => {
    const limiter = createRateLimiter({ capacity: 3, refillMs: 1000 });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("refills one token per refillMs elapsed, using the injected clock", () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 1, refillMs: 1000, now: () => now });

    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);

    now = 999;
    expect(limiter.tryConsume()).toBe(false);

    now = 1000;
    expect(limiter.tryConsume()).toBe(true);
  });

  it("never refills past capacity even after a long idle period", () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 2, refillMs: 1000, now: () => now });
    limiter.tryConsume();
    limiter.tryConsume();

    now = 1_000_000;
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });
});
