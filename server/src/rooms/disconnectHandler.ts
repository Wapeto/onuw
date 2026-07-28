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
  const pendingGrace = new Set<string>();

  function key(roomCode: string, playerId: string): string {
    return `${roomCode}:${playerId}`;
  }

  async function setConnected(roomCode: string, playerId: string, connected: boolean): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) return;
    await saveRoom({
      ...room,
      players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
      updatedAt: Date.now(),
    });
  }

  async function handleDisconnect(roomCode: string, playerId: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) return;
    await setConnected(roomCode, playerId, false);

    if (room.phase !== "NIGHT") return;

    await deps.tickRunner.pauseTick(roomCode);
    const k = key(roomCode, playerId);
    pendingGrace.add(k);
    schedule(async () => {
      if (pendingGrace.has(k)) {
        pendingGrace.delete(k);
        await deps.tickRunner.resumeTick(roomCode);
      }
    }, graceMs);
  }

  async function handleReconnect(roomCode: string, playerId: string): Promise<void> {
    await setConnected(roomCode, playerId, true);
    const k = key(roomCode, playerId);
    if (pendingGrace.has(k)) {
      pendingGrace.delete(k);
      await deps.tickRunner.resumeTick(roomCode);
    }
  }

  return { handleDisconnect, handleReconnect };
}
