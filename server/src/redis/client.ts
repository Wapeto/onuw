import { Redis } from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = new Redis(url);
    // Unhandled 'error' events on an EventEmitter throw and crash the
    // process; ioredis emits one for every connection-level failure. A
    // listener here turns that into a normal, non-fatal event instead of
    // an unhandled exception that can surface as an opaque test failure.
    client.on("error", () => {});
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
