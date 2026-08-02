import type { GameState } from "@onuw/shared";
import { getRoom, saveRoom } from "../rooms/roomStore.js";
import { transition } from "../state/phases.js";

export interface DayTimerDeps {
  broadcast: (roomCode: string, event: string, payload: unknown) => void;
  scheduleAdvance?: (roomCode: string, delayMs: number, token: number) => void;
}

export function createDayTimer(deps: DayTimerDeps) {
  const scheduleAdvance =
    deps.scheduleAdvance ??
    ((roomCode: string, delayMs: number, token: number) => {
      setTimeout(() => {
        void endDay(roomCode, token);
      }, delayMs);
    });

  async function startDay(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) throw new Error(`room ${roomCode} not found`);
    const startedAt = Date.now();
    const durationMs = room.dayDurationMs;
    const updated: GameState = { ...room, day: { startedAt, durationMs }, updatedAt: Date.now() };
    await saveRoom(updated);
    deps.broadcast(roomCode, "DAY_START", { durationMs });
    scheduleAdvance(roomCode, durationMs, startedAt);
  }

  async function endDay(roomCode: string, expectedStartedAt?: number): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.day) return;
    if (expectedStartedAt !== undefined && room.day.startedAt !== expectedStartedAt) return;
    const updated: GameState = { ...transition(room, "VOTE"), day: null, vote: { votes: {} } };
    await saveRoom(updated);
    deps.broadcast(roomCode, "VOTE_START", {});
  }

  return { startDay, endDay };
}
