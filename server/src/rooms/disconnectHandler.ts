import { getRoom, saveRoom, withRoom, RoomNotFoundError } from "./roomStore.js";

export interface DisconnectHandlerTickRunner {
  pauseTick(roomCode: string): Promise<void>;
  resumeTick(roomCode: string): Promise<void>;
}

export interface DisconnectHandlerDeps {
  tickRunner: DisconnectHandlerTickRunner;
  graceMs?: number;
  scheduleGraceTimeout?: (fn: () => void | Promise<void>, ms: number) => void;
}

export const NIGHT_DISCONNECT_GRACE_MS = 40_000;

export function createDisconnectHandler(deps: DisconnectHandlerDeps) {
  const graceMs = deps.graceMs ?? NIGHT_DISCONNECT_GRACE_MS;
  const schedule =
    deps.scheduleGraceTimeout ?? ((fn: () => void | Promise<void>, ms: number) => setTimeout(fn, ms));

  async function setConnected(roomCode: string, playerId: string, connected: boolean): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) return;
    await saveRoom({
      ...room,
      players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
      updatedAt: Date.now(),
    });
  }

  // graceUntil/graceForPlayerId are the cross-instance-safe source of truth
  // for "is a grace period currently open for this room's night, and for
  // which player". They live in Redis (via NightState) rather than in a
  // process-local Set, so a reconnect handled by a different Vercel Function
  // instance than the one that saw the disconnect still resumes immediately
  // instead of waiting out the full grace window. graceForPlayerId preserves
  // the per-player scoping the old Set (keyed by roomCode:playerId) already
  // had: a reconnect from a player who was never disconnected must never
  // resume a grace period that a DIFFERENT player's disconnect opened.
  async function setGrace(roomCode: string, grace: { playerId: string; until: number } | undefined): Promise<void> {
    try {
      await withRoom(roomCode, (room) =>
        room.night
          ? { ...room, night: { ...room.night, graceUntil: grace?.until, graceForPlayerId: grace?.playerId } }
          : room,
      );
    } catch (err) {
      if (err instanceof RoomNotFoundError) return;
      throw err;
    }
  }

  async function handleDisconnect(roomCode: string, playerId: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) return;
    await setConnected(roomCode, playerId, false);

    if (room.phase !== "NIGHT" || !room.night) return;

    await deps.tickRunner.pauseTick(roomCode);
    const graceUntil = Date.now() + graceMs;
    await setGrace(roomCode, { playerId, until: graceUntil });

    schedule(async () => {
      const current = await getRoom(roomCode);
      // Superseded by a reconnect (cleared) or a newer disconnect (a
      // different deadline and/or a different player) in the meantime:
      // this stale timeout is a no-op.
      if (current?.night?.graceUntil !== graceUntil || current.night.graceForPlayerId !== playerId) return;
      await setGrace(roomCode, undefined);
      await deps.tickRunner.resumeTick(roomCode);
    }, graceMs);
  }

  async function handleReconnect(roomCode: string, playerId: string): Promise<void> {
    await setConnected(roomCode, playerId, true);
    const room = await getRoom(roomCode);
    // Only resume if THIS player is the one whose disconnect opened the
    // currently-open grace period — a different player's socket reconnecting
    // (a normal event: phone lock/unlock, tab refresh, brief network blip)
    // must never prematurely resume another player's grace window.
    if (room?.night?.graceUntil == null || room.night.graceForPlayerId !== playerId) return;
    await setGrace(roomCode, undefined);
    await deps.tickRunner.resumeTick(roomCode);
  }

  return { handleDisconnect, handleReconnect };
}
