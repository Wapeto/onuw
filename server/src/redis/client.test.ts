import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getRedisClient, closeRedisClient } from "./client.js";

describe("redis client", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("connects and round-trips a value", async () => {
    const redis = getRedisClient();
    await redis.set("smoke", "ok");
    const value = await redis.get("smoke");
    expect(value).toBe("ok");
  });

  it("returns the same instance on repeated calls", () => {
    expect(getRedisClient()).toBe(getRedisClient());
  });
});
