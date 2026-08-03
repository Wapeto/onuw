import { createAdapter } from "@socket.io/redis-adapter";
import type { Redis } from "ioredis";
import type { Server } from "socket.io";
import { getRedisClient } from "./client.js";

export function attachRedisAdapter(io: Server): Redis {
  const pubClient = getRedisClient();
  const subClient = pubClient.duplicate();
  subClient.on("error", () => {});
  io.adapter(createAdapter(pubClient, subClient));
  return subClient;
}
