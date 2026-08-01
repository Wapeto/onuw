import type { GameState } from "@onuw/shared";
import { getRoom, saveRoom } from "../rooms/roomStore.js";
import { transition } from "../state/phases.js";
import { NIGHT_ORDER, type NightTick } from "./nightOrder.js";

export interface TickRunnerDeps {
  broadcast: (roomCode: string, event: string, payload: unknown) => void;
  emitToPlayer: (playerId: string, event: string, payload: unknown) => void;
  nightOrder?: NightTick[];
  jitterMs?: number;
  scheduleAdvance?: (roomCode: string, delayMs: number, token: number) => void;
}

function computeDuration(tick: NightTick, jitterMs: number): number {
  return tick.baseDurationMs + Math.floor(Math.random() * jitterMs);
}

export function createTickRunner(deps: TickRunnerDeps) {
  const nightOrder = deps.nightOrder ?? NIGHT_ORDER;
  const jitterMs = deps.jitterMs ?? 1500;
  const scheduleAdvance =
    deps.scheduleAdvance ??
    ((roomCode: string, delayMs: number, token: number) => {
      setTimeout(() => {
        void advanceTick(roomCode, token);
      }, delayMs);
    });

  async function scheduleTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night) return;
    const tick = nightOrder[room.night.tickIndex];
    const durationMs = computeDuration(tick, jitterMs);
    const updated: GameState = {
      ...room,
      night: { ...room.night, durationMs, tickStartedAt: Date.now(), paused: false, remainingMsAtPause: null, resolvedActions: {} },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);

    deps.broadcast(roomCode, "TICK_START", { tickIndex: updated.night!.tickIndex, tickId: tick.tickId, durationMs });
    for (const p of updated.players) {
      deps.emitToPlayer(p.id, "TICK_PAYLOAD", { tickId: tick.tickId, active: tick.activeFor(p, updated) });
    }

    scheduleAdvance(roomCode, durationMs, updated.night!.tickStartedAt);
  }

  async function startNight(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) throw new Error(`room ${roomCode} not found`);
    const updated: GameState = {
      ...transition(room, "NIGHT"),
      night: {
        tickIndex: 0,
        tickStartedAt: Date.now(),
        durationMs: 0,
        paused: false,
        remainingMsAtPause: null,
        doppelgangerCopiedRoleId: null,
        doppelgangerCopiedPlayerId: null,
        resolvedActions: {},
      },
    };
    await saveRoom(updated);
    await scheduleTick(roomCode);
  }

  async function advanceTick(roomCode: string, expectedTickStartedAt?: number): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night || room.night.paused) return;
    if (expectedTickStartedAt !== undefined && room.night.tickStartedAt !== expectedTickStartedAt) return;
    const nextIndex = room.night.tickIndex + 1;

    if (nextIndex >= nightOrder.length) {
      const updated: GameState = { ...transition(room, "DAY"), night: null };
      await saveRoom(updated);
      deps.broadcast(roomCode, "NIGHT_END", {});
      return;
    }

    const updated: GameState = { ...room, night: { ...room.night, tickIndex: nextIndex }, updatedAt: Date.now() };
    await saveRoom(updated);
    await scheduleTick(roomCode);
  }

  async function pauseTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night || room.night.paused) return;
    const elapsed = Date.now() - room.night.tickStartedAt;
    const remainingMs = Math.max(room.night.durationMs - elapsed, 0);
    const updated: GameState = {
      ...room,
      night: { ...room.night, paused: true, remainingMsAtPause: remainingMs },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);
    deps.broadcast(roomCode, "TICK_PAUSED", {});
  }

  async function resumeTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night || !room.night.paused) return;
    const remainingMs = room.night.remainingMsAtPause ?? 0;
    const updated: GameState = {
      ...room,
      night: {
        ...room.night,
        paused: false,
        tickStartedAt: Date.now(),
        durationMs: remainingMs,
        remainingMsAtPause: null,
      },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);
    deps.broadcast(roomCode, "TICK_RESUMED", { remainingMs });
    scheduleAdvance(roomCode, remainingMs, updated.night!.tickStartedAt);
  }

  return { startNight, advanceTick, pauseTick, resumeTick, scheduleTick };
}
