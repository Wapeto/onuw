import type { GameState } from "@onuw/shared";
import { getRedisClient } from "../redis/client.js";

export const ROOM_TTL_SECONDS = 4 * 60 * 60;

function roomKey(roomCode: string): string {
  return `room:${roomCode}`;
}

export async function createRoom(state: GameState): Promise<void> {
  const redis = getRedisClient();
  await redis.set(roomKey(state.roomCode), JSON.stringify(state), "EX", ROOM_TTL_SECONDS);
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
