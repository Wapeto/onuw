import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { Server } from "socket.io";
import { createServer } from "node:http";
import type { Redis } from "ioredis";
import { getRedisClient, closeRedisClient } from "./client.js";
import { attachRedisAdapter } from "./socketAdapter.js";

describe("attachRedisAdapter", () => {
  let io: Server | undefined;
  let subClient: Redis | undefined;

  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    io?.close();
    io = undefined;
    if (subClient) {
      await subClient.quit();
      subClient = undefined;
    }
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("replaces the default in-memory adapter with a Redis-backed one", () => {
    io = new Server(createServer());
    subClient = attachRedisAdapter(io);
    expect(io.of("/").adapter.constructor.name).toBe("RedisAdapter");
  });
});
