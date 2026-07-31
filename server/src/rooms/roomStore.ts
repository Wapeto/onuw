import type { GameState } from "@onuw/shared";
import { getRedisClient } from "../redis/client.js";

export const ROOM_TTL_SECONDS = 4 * 60 * 60;

function roomKey(roomCode: string): string {
  return `room:${roomCode}`;
}

export async function createRoom(state: GameState): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.set(roomKey(state.roomCode), JSON.stringify(state), "EX", ROOM_TTL_SECONDS, "NX");
  return result === "OK";
}

export async function getRoom(roomCode: string): Promise<GameState | null> {
  const redis = getRedisClient();
  const raw = await redis.get(roomKey(roomCode));
  return raw ? (JSON.parse(raw) as GameState) : null;
}

export async function saveRoom(state: GameState): Promise<void> {
  const redis = getRedisClient();
  await redis.set(roomKey(state.roomCode), JSON.stringify(state), "EX", ROOM_TTL_SECONDS);
}

export async function deleteRoom(roomCode: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(roomKey(roomCode));
}

export class RoomNotFoundError extends Error {
  constructor(roomCode: string) {
    super(`room ${roomCode} not found`);
    this.name = "RoomNotFoundError";
  }
}

export async function withRoom(
  roomCode: string,
  mutate: (state: GameState) => GameState,
  maxAttempts = 20,
): Promise<GameState> {
  const key = roomKey(roomCode);
  // WATCH is connection-scoped: a dedicated connection per call keeps concurrent
  // withRoom() invocations from merging watch state and silently breaking the CAS.
  const conn = getRedisClient().duplicate();
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await conn.watch(key);
      const raw = await conn.get(key);
      if (!raw) {
        await conn.unwatch();
        throw new RoomNotFoundError(roomCode);
      }
      const next = mutate(JSON.parse(raw) as GameState);
      const result = await conn.multi().set(key, JSON.stringify(next), "EX", ROOM_TTL_SECONDS).exec();
      if (result !== null) return next;
    }
    throw new Error(`withRoom: exceeded ${maxAttempts} attempts for room ${roomCode}`);
  } finally {
    await conn.quit();
  }
}
