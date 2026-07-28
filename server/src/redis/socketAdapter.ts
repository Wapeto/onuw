import { createAdapter } from "@socket.io/redis-adapter";
import type { Server } from "socket.io";
import { getRedisClient } from "./client.js";

export function attachRedisAdapter(io: Server): void {
  const pubClient = getRedisClient();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
}
