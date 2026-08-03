import { getRoom, saveRoom } from "./roomStore.js";

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

  // graceUntil is the cross-instance-safe source of truth for "is a grace
  // period currently open for this room's night". It lives in Redis (via
  // NightState) rather than in a process-local Set, so a reconnect handled
  // by a different Vercel Function instance than the one that saw the
  // disconnect still resumes immediately instead of waiting out the full
  // grace window.
  async function setGraceUntil(roomCode: string, graceUntil: number | undefined): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night) return;
    await saveRoom({ ...room, night: { ...room.night, graceUntil }, updatedAt: Date.now() });
  }

  async function handleDisconnect(roomCode: string, playerId: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) return;
    await setConnected(roomCode, playerId, false);

    if (room.phase !== "NIGHT" || !room.night) return;

    await deps.tickRunner.pauseTick(roomCode);
    const graceUntil = Date.now() + graceMs;
    await setGraceUntil(roomCode, graceUntil);

    schedule(async () => {
      const current = await getRoom(roomCode);
      // Superseded by a reconnect (cleared) or a newer disconnect (a
      // different deadline) in the meantime: this stale timeout is a no-op.
      if (current?.night?.graceUntil !== graceUntil) return;
      await setGraceUntil(roomCode, undefined);
      await deps.tickRunner.resumeTick(roomCode);
    }, graceMs);
  }

  async function handleReconnect(roomCode: string, playerId: string): Promise<void> {
    await setConnected(roomCode, playerId, true);
    const room = await getRoom(roomCode);
    if (room?.night?.graceUntil == null) return;
    await setGraceUntil(roomCode, undefined);
    await deps.tickRunner.resumeTick(roomCode);
  }

  return { handleDisconnect, handleReconnect };
}
