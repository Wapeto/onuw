import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { getRedisClient, closeRedisClient } from "./client.js";
import { attachRedisAdapter } from "./socketAdapter.js";

describe("attachRedisAdapter", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("replaces the default in-memory adapter with a Redis-backed one", () => {
    const io = new Server(createServer());
    attachRedisAdapter(io);
    expect(io.of("/").adapter.constructor.name).toBe("RedisAdapter");
    io.close();
  });
});
