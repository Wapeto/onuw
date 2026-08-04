import type { GameState } from "@onuw/shared";
import { getRoom, saveRoom } from "../rooms/roomStore.js";
import { canTransition, transition } from "../state/phases.js";
import { NIGHT_ORDER, nightOrderFor, type NightTick } from "./nightOrder.js";

export interface TickRunnerDeps {
  broadcast: (roomCode: string, event: string, payload: unknown) => void;
  emitToPlayer: (playerId: string, event: string, payload: unknown) => void;
  nightOrder?: NightTick[];
  jitterMs?: number;
  scheduleAdvance?: (roomCode: string, delayMs: number, token: number) => void;
  onNightEnd?: (roomCode: string) => Promise<void> | void;
}

function computeDuration(tick: NightTick, jitterMs: number): number {
  return tick.baseDurationMs + Math.floor(Math.random() * jitterMs);
}

export function createTickRunner(deps: TickRunnerDeps) {
  const baseNightOrder = deps.nightOrder ?? NIGHT_ORDER;
  const jitterMs = deps.jitterMs ?? 1500;
  const scheduleAdvance =
    deps.scheduleAdvance ??
    ((roomCode: string, delayMs: number, token: number) => {
      setTimeout(() => {
        void advanceTick(roomCode, token);
      }, delayMs);
    });

  // The deck is frozen for the whole night, so this is stable across calls
  // and `tickIndex` keeps indexing the same list from TICK_START to NIGHT_END.
  function orderFor(room: GameState): NightTick[] {
    return nightOrderFor(room, baseNightOrder);
  }

  async function endNight(room: GameState): Promise<void> {
    const updated: GameState = { ...transition(room, "DAY"), night: null };
    await saveRoom(updated);
    deps.broadcast(room.roomCode, "NIGHT_END", {});
    await deps.onNightEnd?.(room.roomCode);
  }

  async function scheduleTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night) return;
    const nightOrder = orderFor(room);
    const tick = nightOrder[room.night.tickIndex];
    if (!tick) return;
    const durationMs = computeDuration(tick, jitterMs);
    const updated: GameState = {
      ...room,
      night: { ...room.night, durationMs, tickStartedAt: Date.now(), paused: false, remainingMsAtPause: null, resolvedActions: {} },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);

    deps.broadcast(roomCode, "TICK_START", {
      tickIndex: updated.night!.tickIndex,
      tickId: tick.tickId,
      durationMs,
      // Position in the night, so every player — acting or not — can see the
      // night is a finite thing making progress rather than an unmarked void.
      tickNumber: updated.night!.tickIndex + 1,
      tickCount: nightOrder.length,
    });
    for (const p of updated.players) {
      deps.emitToPlayer(p.id, "TICK_PAYLOAD", { tickId: tick.tickId, active: tick.activeFor(p, updated) });
    }

    scheduleAdvance(roomCode, durationMs, updated.night!.tickStartedAt);
  }

  async function startNight(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) throw new Error(`room ${roomCode} not found`);
    // Two players tapping "prêt" at the same instant both observe a full
    // ready set, so both call in here. The second one is a no-op rather than
    // an invalid-transition error surfacing as a toast on someone's phone.
    if (!canTransition(room.phase, "NIGHT")) return;
    const updated: GameState = {
      ...transition(room, "NIGHT"),
      roleReveal: null,
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
    // A deck with no waking roles at all (possible in Personnalisé) would
    // otherwise index past the end of an empty order and strand the room.
    if (orderFor(updated).length === 0) {
      await endNight(updated);
      return;
    }
    await scheduleTick(roomCode);
  }

  async function advanceTick(roomCode: string, expectedTickStartedAt?: number): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night || room.night.paused) return;
    if (expectedTickStartedAt !== undefined && room.night.tickStartedAt !== expectedTickStartedAt) return;
    const nextIndex = room.night.tickIndex + 1;

    if (nextIndex >= orderFor(room).length) {
      await endNight(room);
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
