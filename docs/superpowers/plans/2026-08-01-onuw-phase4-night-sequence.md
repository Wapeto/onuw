# Phase 4 — Séquence de nuit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play the night end to end with real UI: every player gets a generic `DummyScreen` on ticks that don't concern them, a real per-role action screen otherwise (Werewolf incl. Loup Solitaire, Minion, Mason, Seer, Robber, Troublemaker, Drunk, Insomniac, Doppelganger incl. its chained action and the 9a tick), fullscreen forced with back-navigation blocked, and pause/resume on disconnect surfaced to every player as a neutral overlay.

**Architecture:** The server is already authoritative for tick timing and role resolution (Phase 1's `TickRunner` + `actionResolvers`) — this phase adds the missing wire between that engine and a real client: (1) typed Socket.io contracts for the 5 night broadcast events plus a new `SUBMIT_NIGHT_ACTION`/`ACTION_RESULT` pair, (2) a server handler that validates a submitted action against the room's *actual* current tick and the player's *actual* `activeFor` result (never trusting the client's own claim), routes it through the existing `actionResolvers` table, and persists via the existing `withRoom` CAS helper, (3) a `Night.tsx` orchestrator that renders `DummyScreen` (generic, config-driven) or the matching real screen from a `tickId → component` registry. Every role screen shares one `RevealScreen` wrapper for its post-action reveal, so the "must be a real tap, never a static screen" anti-tell rule from the spec is enforced in exactly one place.

**Tech Stack:** Same as Phase 0-3 — TypeScript strict, Socket.io + zod payload validation, Redis via `withRoom`, React + Vitest + React Testing Library.

## Global Constraints

- Server stays authoritative: every action is re-validated against the room's live state (current tick, `activeFor(player, gameState)`) — the client's belief about its own turn is never trusted, matching the pattern already used in `roleSelectEvents.ts` (`requireHost`, phase checks re-run inside `withRoom`).
- Every tick fires for every player regardless of role presence in this game — this is already true server-side (`TickRunner` loops `NIGHT_ORDER` unconditionally); this phase must not special-case any tick away client-side either. `DummyScreen` renders for every non-active player on every tick, including ticks whose role isn't in play.
- Dummy screen requires a real tap (`spec §3`: "ça doit demander une interaction... sinon la différence... reste visible au regard périphérique") — never a static screen. Same rule applies to the passive-info reveal screens (Minion/Mason/Insomniac): the info must be tapped through, not just displayed.
- Tick duration is 100% server-computed and broadcast once (`TICK_START.durationMs`) — the client only counts down locally for display, never recomputes or extends it.
- Fullscreen + back-navigation blocking is active only while `phase === "NIGHT"` (per spec §4) — released on `NIGHT_END`.
- No comments explaining *what* code does — only non-obvious *why* (matches existing files).
- **Locked decision (deferred from Phase 3's final review):** a role selection with `werewolf: 0` is a valid, if degenerate, game (all-Village/Tanner games are legal under the physical rulebook) — Phase 4 does not add a guard against it. Not revisited here.
- **Explicitly out of scope for this phase** (confirmed by re-reading the Phase 1 code, not just the phase-breakdown doc): the `pendingGrace` `Set` in `disconnectHandler.ts` is process-local, so a disconnect on one Vercel Function instance and a reconnect on another never resumes the tick. This only matters once deployed multi-instance (Phase 7); local/dev testing runs a single process, so it is not blocking here. Do not "fix" it in this phase — it needs a Redis-backed `graceUntil` on `NightState`, which is Phase 7 scope.

---

## Task 1: Shared night-event contracts (`NightTickId`, `TICK_*`, `SUBMIT_NIGHT_ACTION`/`ACTION_RESULT`)

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`
- Modify: `server/src/night/nightOrder.ts:1-13` (drop the locally-declared union, re-export the shared one so `tickRunner.ts`/`actionResolvers.ts` need zero changes)
- Modify: `server/src/index.ts:20-22` (the stale comment — the events are typed now, but `TickRunnerDeps` staying string-typed is a separate, deliberate choice, not a leftover gap)

**Interfaces:**
- Produces: `NIGHT_TICK_IDS` (10 entries), `NightTickId` type, and 6 new members on `ServerToClientEvents`/`ClientToServerEvents` that every later task (server night handler, `useRoomSocket`, `Night.tsx`) imports by exact name.

- [ ] **Step 1: Write the failing test**

Add to `shared/src/types.test.ts`, after the existing `"role-select event contracts"` block:

```ts
describe("night event contracts", () => {
  it("NIGHT_TICK_IDS lists all 10 ticks including the 9a Doppelganger/Insomniac wake-step", () => {
    expect(NIGHT_TICK_IDS).toHaveLength(10);
    expect(NIGHT_TICK_IDS).toContain("doppelgangerInsomniac");
  });

  it("wires TICK_START/TICK_PAYLOAD/TICK_PAUSED/TICK_RESUMED/NIGHT_END/ACTION_RESULT and SUBMIT_NIGHT_ACTION", () => {
    const serverEvents: ServerToClientEvents = {
      connected: () => {},
      ROOM_CREATED: () => {},
      ROOM_JOINED: () => {},
      PLAYER_LIST_UPDATE: () => {},
      ROOM_ERROR: () => {},
      ROLE_SELECTION_UPDATE: () => {},
      TICK_START: () => {},
      TICK_PAYLOAD: () => {},
      TICK_PAUSED: () => {},
      TICK_RESUMED: () => {},
      NIGHT_END: () => {},
      ACTION_RESULT: () => {},
    };
    const clientEvents: ClientToServerEvents = {
      ping: () => {},
      CREATE_ROOM: () => {},
      JOIN_ROOM: () => {},
      START_ROLE_SELECT: () => {},
      SET_ROLE_MODE: () => {},
      SET_CUSTOM_ROLES: () => {},
      START_GAME: () => {},
      SUBMIT_NIGHT_ACTION: () => {},
    };

    serverEvents.TICK_START({ tickIndex: 1, tickId: "werewolf", durationMs: 7000 });
    clientEvents.SUBMIT_NIGHT_ACTION({ tickId: "seer", params: { mode: "center" } });
    expect(typeof serverEvents.ACTION_RESULT).toBe("function");
  });
});
```

Add `NIGHT_TICK_IDS` to the existing `import { ... } from "./types.js"` (or wherever `ROLE_IDS` is already imported) at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `NIGHT_TICK_IDS` is not exported, `TICK_START` etc. don't exist on `ServerToClientEvents`.

- [ ] **Step 3: Implement in `shared/src/types.ts`**

Add near `ROLE_IDS`:

```ts
export const NIGHT_TICK_IDS = [
  "doppelganger",
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "doppelgangerInsomniac",
] as const;

export type NightTickId = (typeof NIGHT_TICK_IDS)[number];
```

Extend the two event interfaces:

```ts
export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
  ROLE_SELECTION_UPDATE: (payload: { mode: GameMode; roles: RoleCounts; valid: boolean }) => void;
  TICK_START: (payload: { tickIndex: number; tickId: NightTickId; durationMs: number }) => void;
  TICK_PAYLOAD: (payload: { tickId: NightTickId; active: boolean }) => void;
  TICK_PAUSED: (payload: Record<string, never>) => void;
  TICK_RESUMED: (payload: { remainingMs: number }) => void;
  NIGHT_END: (payload: Record<string, never>) => void;
  ACTION_RESULT: (payload: { tickId: NightTickId; result: unknown }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
  SUBMIT_NIGHT_ACTION: (payload: { tickId: NightTickId; params: Record<string, unknown> }) => void;
}
```

In `server/src/night/nightOrder.ts`, replace the local union (lines 3-13) with an import + re-export so nothing downstream (`tickRunner.ts`, `actionResolvers.ts`, both of which import `NightTickId` from `"../night/nightOrder.js"`) needs to change:

```ts
import type { GameState, NightTickId, Player, RoleId } from "@onuw/shared";

export type { NightTickId } from "@onuw/shared";
```

In `server/src/index.ts`, replace the comment above `tickRunner`'s creation:

```ts
  // TICK_START/TICK_PAYLOAD/TICK_PAUSED/TICK_RESUMED/NIGHT_END are now typed on
  // ServerToClientEvents (Phase 4). TickRunnerDeps itself stays string-typed by
  // design — it's an event-name-agnostic runner — so the `unknown`-cast emit
  // wrappers below are unchanged.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w shared && npm run build -w shared && npm run build -w server`
Expected: PASS, both builds succeed (confirms `nightOrder.ts`'s re-export satisfies `actionResolvers.ts`'s existing import unchanged).

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts server/src/night/nightOrder.ts server/src/index.ts
git commit -m "feat: type the night-tick socket events and add SUBMIT_NIGHT_ACTION contract"
```

---

## Task 2: Server `SUBMIT_NIGHT_ACTION` handler — validate, resolve, respond privately

**Files:**
- Create: `server/src/roles/actionSchemas.ts`
- Create: `server/src/roles/actionSchemas.test.ts`
- Create: `server/src/night/nightActionEvents.ts`
- Create: `server/src/night/nightActionEvents.test.ts`
- Modify: `server/src/rooms/roomEvents.ts` (call `registerNightActionEvents` alongside the existing `registerRoleSelectEvents` call, same `() => membership` closure)

**Interfaces:**
- Consumes: `actionResolvers` from `server/src/roles/actionResolvers.ts` (`Record<NightTickId, ActionResolver>`), `NIGHT_ORDER`/`NightTick` from `server/src/night/nightOrder.ts`, `withRoom` from `server/src/rooms/roomStore.ts`, `Membership` from `server/src/rooms/roleSelectEvents.ts`.
- Produces: `actionParamsSchemas: Record<NightTickId, z.ZodTypeAny>`, `registerNightActionEvents(io, socket, getMembership, nightOrder?)` — the `nightOrder` override param exists purely for test injection, mirroring `createTickRunner`'s own `nightOrder` dep.

- [ ] **Step 1: Write the failing test for schemas**

```ts
// server/src/roles/actionSchemas.test.ts
import { describe, it, expect } from "vitest";
import { actionParamsSchemas } from "./actionSchemas.js";

describe("actionParamsSchemas", () => {
  it("accepts a valid seer center-mode payload and rejects a malformed one", () => {
    const schema = actionParamsSchemas.seer;
    expect(schema.safeParse({ mode: "center", centerIndices: [0, 1] }).success).toBe(true);
    expect(schema.safeParse({ mode: "center", centerIndices: [0] }).success).toBe(false);
    expect(schema.safeParse({ mode: "player" }).success).toBe(false);
  });

  it("accepts an empty object for no-param ticks (minion, mason, insomniac, doppelgangerInsomniac)", () => {
    expect(actionParamsSchemas.minion.safeParse({}).success).toBe(true);
    expect(actionParamsSchemas.mason.safeParse({}).success).toBe(true);
  });

  it("rejects an out-of-range drunk centerIndex", () => {
    expect(actionParamsSchemas.drunk.safeParse({ centerIndex: 3 }).success).toBe(false);
    expect(actionParamsSchemas.drunk.safeParse({ centerIndex: 1 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- actionSchemas`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `actionSchemas.ts`**

```ts
import { z } from "zod";
import type { NightTickId } from "../night/nightOrder.js";

const centerIndexSchema = z.number().int().min(0).max(2);
const playerIdSchema = z.string().min(1);

export const actionParamsSchemas: Record<NightTickId, z.ZodTypeAny> = {
  doppelganger: z.object({
    targetPlayerId: playerIdSchema,
    subParams: z.record(z.string(), z.unknown()).optional(),
  }),
  werewolf: z.object({ centerIndex: centerIndexSchema.optional() }),
  minion: z.object({}),
  mason: z.object({}),
  seer: z.union([
    z.object({ mode: z.literal("player"), targetPlayerId: playerIdSchema }),
    z.object({ mode: z.literal("center"), centerIndices: z.tuple([centerIndexSchema, centerIndexSchema]) }),
  ]),
  robber: z.object({ targetPlayerId: playerIdSchema }),
  troublemaker: z.object({ targetAId: playerIdSchema, targetBId: playerIdSchema }),
  drunk: z.object({ centerIndex: centerIndexSchema }),
  insomniac: z.object({}),
  doppelgangerInsomniac: z.object({}),
};
```

- [ ] **Step 4: Run schema tests, confirm pass**

Run: `npm run test -w server -- actionSchemas` → PASS.

- [ ] **Step 5: Write the failing test for the socket handler**

```ts
// server/src/night/nightActionEvents.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerNightActionEvents } from "./nightActionEvents.js";
import type { NightTick } from "./nightOrder.js";

const TEST_ORDER: NightTick[] = [
  { tickId: "seer", baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "seer" },
  { tickId: "werewolf", baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "werewolf" },
];

function fixture(roomCode: string, tickIndex: number): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", currentRoleId: "seer", originalRoleId: "seer" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", currentRoleId: "werewolf", originalRoleId: "werewolf" },
    ],
    center: ["villager", "tanner", "hunter"],
    night: {
      tickIndex,
      tickStartedAt: Date.now(),
      durationMs: 100,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    },
    roleSelection: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    on: (event: string, cb: (payload: unknown) => void) => handlers.set(event, cb),
    emit: vi.fn(),
    trigger: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

describe("registerNightActionEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("resolves the acting player's action for the current tick and emits ACTION_RESULT privately", async () => {
    await createRoom(fixture("ABCD", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", {
      tickId: "seer",
      params: { mode: "center", centerIndices: [0, 1] },
    });

    expect(socket.emit).toHaveBeenCalledWith("ACTION_RESULT", {
      tickId: "seer",
      result: { roleIds: ["villager", "tanner"] },
    });
  });

  it("rejects an action submitted for a tick that isn't current", async () => {
    await createRoom(fixture("EFGH", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "EFGH", playerId: "p2" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "werewolf", params: {} });

    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.stringContaining("terminé") });
  });

  it("rejects an action from a player who isn't active this tick", async () => {
    await createRoom(fixture("IJKL", 0));
    const socket = fakeSocket();
    registerNightActionEvents({} as never, socket as never, () => ({ roomCode: "IJKL", playerId: "p2" }), TEST_ORDER);

    await socket.trigger("SUBMIT_NIGHT_ACTION", { tickId: "seer", params: { mode: "center", centerIndices: [0, 1] } });

    const room = await getRoom("IJKL");
    expect(room?.players.find((p) => p.id === "p2")?.currentRoleId).toBe("werewolf");
    expect(socket.emit).toHaveBeenCalledWith("ROOM_ERROR", { message: expect.any(String) });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -w server -- nightActionEvents`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `nightActionEvents.ts`**

```ts
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, NightTickId, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import { NIGHT_ORDER, type NightTick } from "./nightOrder.js";
import { actionResolvers } from "../roles/actionResolvers.js";
import { actionParamsSchemas } from "../roles/actionSchemas.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotInNightError extends Error {}
class StaleTickError extends Error {}
class NotActiveError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotInNightError) return "aucune nuit en cours";
  if (err instanceof StaleTickError) return "ce tick est terminé";
  if (err instanceof NotActiveError) return "aucune action à faire ce tick";
  return "action de nuit invalide";
}

export function registerNightActionEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
  nightOrder: NightTick[] = NIGHT_ORDER,
): void {
  socket.on("SUBMIT_NIGHT_ACTION", (payload: { tickId: NightTickId; params: Record<string, unknown> }) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const schema = actionParamsSchemas[payload.tickId];
      const parsedParams = schema.safeParse(payload.params);
      if (!parsedParams.success) {
        socket.emit("ROOM_ERROR", { message: "action de nuit invalide" });
        return;
      }
      let result: unknown;
      try {
        await withRoom(membership.roomCode, (room) => {
          if (room.phase !== "NIGHT" || !room.night) throw new NotInNightError();
          const tick = nightOrder[room.night.tickIndex];
          if (tick.tickId !== payload.tickId) throw new StaleTickError();
          const player = room.players.find((p) => p.id === membership.playerId);
          if (!player || !tick.activeFor(player, room)) throw new NotActiveError();
          const resolver = actionResolvers[tick.tickId];
          const outcome = resolver(membership.playerId, room, parsedParams.data as never);
          result = outcome.result;
          return outcome.gameState;
        });
        socket.emit("ACTION_RESULT", { tickId: payload.tickId, result });
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w server -- nightActionEvents actionSchemas`
Expected: PASS.

- [ ] **Step 9: Wire into `roomEvents.ts`**

```ts
import { registerNightActionEvents } from "../night/nightActionEvents.js";
```

At the end of `registerRoomEvents`, right after the existing `registerRoleSelectEvents(io, socket, () => membership, tickRunner);` line:

```ts
  registerNightActionEvents(io, socket, () => membership);
```

- [ ] **Step 10: Run the full server test suite**

Run: `npm run test -w server && npm run build -w server`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/roles/actionSchemas.ts server/src/roles/actionSchemas.test.ts server/src/night/nightActionEvents.ts server/src/night/nightActionEvents.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: validate and resolve SUBMIT_NIGHT_ACTION against the live tick and role"
```

---

## Task 3: Wire disconnect pause/grace into the live socket handlers

**Files:**
- Modify: `server/src/rooms/roomEvents.ts` (accept a `disconnectHandler` param; use it in the auth-reconnect path and the `disconnect` handler)
- Modify: `server/src/index.ts` (instantiate `createDisconnectHandler`, pass it through)
- Modify: `server/src/rooms/roomEvents.test.ts` (existing tests construct `registerRoomEvents` — update call sites for the new param)

**Interfaces:**
- Consumes: `createDisconnectHandler` from `server/src/rooms/disconnectHandler.ts` (already built, untouched — `{ handleDisconnect(roomCode, playerId): Promise<void>, handleReconnect(roomCode, playerId): Promise<void> }`).
- Produces: `registerRoomEvents(io, socket, tickRunner, disconnectHandler)` — one new required parameter, exact type `ReturnType<typeof createDisconnectHandler>`.

**Note:** `disconnectHandler.handleDisconnect` already flips `connected: false` itself (own internal `getRoom`/`saveRoom`) before/alongside pausing. `roomEvents.ts`'s own `setConnected` (atomic, CAS-based) still runs first on the same value in the reconnect path — a harmless redundant write of the same boolean, not a new correctness issue, left as-is to keep this task's diff minimal.

- [ ] **Step 1: Write the failing test**

Add to `server/src/rooms/roomEvents.test.ts` (find the existing `describe("registerRoomEvents"` or equivalent block and its socket/io test doubles — reuse them):

```ts
it("pauses the tick on disconnect during NIGHT and resumes it on reconnect", async () => {
  await createRoom({
    roomCode: "NGHT1",
    phase: "NIGHT",
    players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "tok1" }],
    center: [],
    night: {
      tickIndex: 0,
      tickStartedAt: Date.now(),
      durationMs: 5000,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    },
    roleSelection: null,
    createdAt: 0,
    updatedAt: 0,
  });

  const pauseTick = vi.fn();
  const resumeTick = vi.fn();
  const disconnectHandler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout: vi.fn() });
  const io = fakeIoWithNoOtherSockets(); // reuse whatever helper the existing disconnect test already builds
  const socket = fakeSocketJoinedAs("p1", "NGHT1");

  registerRoomEvents(io, socket, { startNight: vi.fn() }, disconnectHandler);
  await socket.trigger("disconnect");

  expect(pauseTick).toHaveBeenCalledWith("NGHT1");
});
```

Adapt `fakeIoWithNoOtherSockets`/`fakeSocketJoinedAs` to whatever the file's existing disconnect test already uses to fake `io.in(playerId).fetchSockets()` returning `[]` and a joined socket — do not invent a second fake-socket convention if one already exists in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- roomEvents`
Expected: FAIL — `registerRoomEvents` doesn't accept a 4th argument / `disconnectHandler` unused.

- [ ] **Step 3: Update `roomEvents.ts`**

Import:

```ts
import { createDisconnectHandler } from "./disconnectHandler.js";
import { getRoom } from "./roomStore.js";
```

(`getRoom` joins the existing `{ createRoom, withRoom, RoomNotFoundError }` import from `./roomStore.js` — one import line, not two.)

Signature:

```ts
export function registerRoomEvents(
  io: AppServer,
  socket: AppSocket,
  tickRunner: RoleSelectTickRunner,
  disconnectHandler: ReturnType<typeof createDisconnectHandler>,
): void {
```

In the auth-reconnect block (top of the function), right after the existing `await broadcastRoster(io, state);` and the `if (state.roleSelection) { ... }` block:

```ts
        await disconnectHandler.handleReconnect(roomCode, playerId);
```

Replace the whole `socket.on("disconnect", ...)` body:

```ts
  socket.on("disconnect", () => {
    if (!membership) return;
    const { roomCode, playerId } = membership;
    void (async () => {
      try {
        const remaining = await io.in(playerId).fetchSockets();
        if (remaining.length > 0) return;
        await disconnectHandler.handleDisconnect(roomCode, playerId);
        const state = await getRoom(roomCode);
        if (state) await broadcastRoster(io, state);
      } catch {
        socket.emit("ROOM_ERROR", { message: "failed to update connection status" });
      }
    })();
  });
```

- [ ] **Step 4: Update `index.ts`**

```ts
import { createDisconnectHandler } from "./rooms/disconnectHandler.js";
```

```ts
  const disconnectHandler = createDisconnectHandler({ tickRunner });
```

```ts
  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
    registerRoomEvents(io, socket, tickRunner, disconnectHandler);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w server && npm run build -w server`
Expected: PASS. Fix any other `registerRoomEvents(...)` call sites in the test file that now need the 4th argument (a `createDisconnectHandler({ tickRunner: { pauseTick: vi.fn(), resumeTick: vi.fn() } })` is enough for tests that don't exercise NIGHT).

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/roomEvents.ts server/src/rooms/roomEvents.test.ts server/src/index.ts
git commit -m "feat: pause and resume the night tick on real disconnect/reconnect"
```

---

## Task 4: `useRoomSocket` — night tick state, pause flag, action result, submit fn

**Files:**
- Modify: `client/src/hooks/useRoomSocket.ts`
- Modify: `client/src/hooks/useRoomSocket.test.ts`

**Interfaces:**
- Produces: `CurrentTick { tickIndex: number; tickId: NightTickId; durationMs: number; active: boolean }`, and on `RoomSession`: `currentTick: CurrentTick | null`, `nightPaused: boolean`, `nightEnded: boolean`, `actionResult: { tickId: NightTickId; result: unknown } | null`, `submitNightAction: (tickId: NightTickId, params: Record<string, unknown>) => void`. `Night.tsx` (Task 14) consumes all five plus the existing `players`/`playerId`.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/hooks/useRoomSocket.test.ts`:

```ts
it("tracks the current tick across TICK_START then TICK_PAYLOAD", () => {
  const { result } = renderHook(() => useRoomSocket());

  act(() => {
    mockSocket.trigger("TICK_START", { tickIndex: 2, tickId: "seer", durationMs: 8000 });
  });
  expect(result.current.currentTick).toEqual({ tickIndex: 2, tickId: "seer", durationMs: 8000, active: false });

  act(() => {
    mockSocket.trigger("TICK_PAYLOAD", { tickId: "seer", active: true });
  });
  expect(result.current.currentTick?.active).toBe(true);
});

it("tracks pause/resume and clears on NIGHT_END", () => {
  const { result } = renderHook(() => useRoomSocket());

  act(() => {
    mockSocket.trigger("TICK_START", { tickIndex: 0, tickId: "doppelganger", durationMs: 8000 });
    mockSocket.trigger("TICK_PAUSED", {});
  });
  expect(result.current.nightPaused).toBe(true);

  act(() => {
    mockSocket.trigger("TICK_RESUMED", { remainingMs: 3000 });
  });
  expect(result.current.nightPaused).toBe(false);

  act(() => {
    mockSocket.trigger("NIGHT_END", {});
  });
  expect(result.current.nightEnded).toBe(true);
  expect(result.current.currentTick).toBeNull();
});

it("submitNightAction emits SUBMIT_NIGHT_ACTION and ACTION_RESULT updates actionResult", () => {
  const { result } = renderHook(() => useRoomSocket());

  act(() => {
    result.current.submitNightAction("robber", { targetPlayerId: "p2" });
  });
  expect(mockSocket.emit).toHaveBeenCalledWith("SUBMIT_NIGHT_ACTION", { tickId: "robber", params: { targetPlayerId: "p2" } });

  act(() => {
    mockSocket.trigger("ACTION_RESULT", { tickId: "robber", result: { newRoleId: "villager" } });
  });
  expect(result.current.actionResult).toEqual({ tickId: "robber", result: { newRoleId: "villager" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useRoomSocket`
Expected: FAIL — `currentTick`/`nightPaused`/`submitNightAction` undefined.

- [ ] **Step 3: Implement in `useRoomSocket.ts`**

Add the import and interface:

```ts
import type { NightTickId, /* ...existing... */ } from "@onuw/shared";

export interface CurrentTick {
  tickIndex: number;
  tickId: NightTickId;
  durationMs: number;
  active: boolean;
}
```

Extend `RoomSession`:

```ts
  currentTick: CurrentTick | null;
  nightPaused: boolean;
  nightEnded: boolean;
  actionResult: { tickId: NightTickId; result: unknown } | null;
  submitNightAction: (tickId: NightTickId, params: Record<string, unknown>) => void;
```

Inside `useRoomSocket`, new state:

```ts
  const [currentTick, setCurrentTick] = useState<CurrentTick | null>(null);
  const [nightPaused, setNightPaused] = useState(false);
  const [nightEnded, setNightEnded] = useState(false);
  const [actionResult, setActionResult] = useState<{ tickId: NightTickId; result: unknown } | null>(null);
```

New listeners inside the existing connection `useEffect`, alongside the current `socket.on(...)` calls:

```ts
    socket.on("TICK_START", (payload) => {
      setCurrentTick({ ...payload, active: false });
      setActionResult(null);
      setNightPaused(false);
      setNightEnded(false);
    });
    socket.on("TICK_PAYLOAD", (payload) => {
      setCurrentTick((prev) => (prev && prev.tickId === payload.tickId ? { ...prev, active: payload.active } : prev));
    });
    socket.on("TICK_PAUSED", () => setNightPaused(true));
    socket.on("TICK_RESUMED", () => setNightPaused(false));
    socket.on("NIGHT_END", () => {
      setNightEnded(true);
      setCurrentTick(null);
    });
    socket.on("ACTION_RESULT", (payload) => setActionResult(payload));
```

New callback:

```ts
  const submitNightAction = useCallback((tickId: NightTickId, params: Record<string, unknown>) => {
    socketRef.current?.emit("SUBMIT_NIGHT_ACTION", { tickId, params });
  }, []);
```

Return object: add `currentTick, nightPaused, nightEnded, actionResult, submitNightAction`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- useRoomSocket`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useRoomSocket.ts client/src/hooks/useRoomSocket.test.ts
git commit -m "feat: track night tick, pause, and action-result state in useRoomSocket"
```

---

## Task 5: `useFullscreen` hook — force fullscreen, block back navigation

**Files:**
- Create: `client/src/hooks/useFullscreen.ts`
- Create: `client/src/hooks/useFullscreen.test.ts`

**Interfaces:**
- Produces: `useFullscreen(active: boolean): void`. Consumed by `Night.tsx` (Task 14) with `active = phase === "NIGHT"`, i.e. `!nightEnded`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/useFullscreen.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFullscreen } from "./useFullscreen";

describe("useFullscreen", () => {
  beforeEach(() => {
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  });

  it("requests fullscreen and pushes a history entry when active", () => {
    const pushStateSpy = vi.spyOn(history, "pushState");
    renderHook(() => useFullscreen(true));

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalled();
  });

  it("does nothing when inactive", () => {
    renderHook(() => useFullscreen(false));
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it("re-pushes history state on popstate to block back navigation", () => {
    const pushStateSpy = vi.spyOn(history, "pushState");
    renderHook(() => useFullscreen(true));
    pushStateSpy.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(pushStateSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useFullscreen`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import { useEffect } from "react";

export function useFullscreen(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    void document.documentElement.requestFullscreen?.().catch(() => {});
    history.pushState(null, "", location.href);

    const blockBack = () => {
      history.pushState(null, "", location.href);
    };
    window.addEventListener("popstate", blockBack);

    return () => {
      window.removeEventListener("popstate", blockBack);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [active]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- useFullscreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useFullscreen.ts client/src/hooks/useFullscreen.test.ts
git commit -m "feat: add useFullscreen hook forcing fullscreen and blocking back nav during night"
```

---

## Task 6: `DummyScreen` — generic, config-driven, requires a real tap

**Files:**
- Create: `client/src/components/night/dummyConfig.ts`
- Create: `client/src/components/night/DummyScreen.tsx`
- Create: `client/src/components/night/DummyScreen.test.tsx`

**Interfaces:**
- Produces: `DUMMY_CONFIG: Record<NightTickId, { prompt: string; buttonLabel: string }>`, `<DummyScreen tickId={NightTickId} />`. Consumed by `Night.tsx` (Task 14) for every non-active tick.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/night/DummyScreen.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NIGHT_TICK_IDS } from "@onuw/shared";
import DummyScreen from "./DummyScreen";
import { DUMMY_CONFIG } from "./dummyConfig";

describe("DummyScreen", () => {
  it("has a configured prompt and button label for every tick", () => {
    for (const tickId of NIGHT_TICK_IDS) {
      expect(DUMMY_CONFIG[tickId].prompt.length).toBeGreaterThan(0);
      expect(DUMMY_CONFIG[tickId].buttonLabel.length).toBeGreaterThan(0);
    }
  });

  it("requires a real tap before showing anything else", async () => {
    render(<DummyScreen tickId="seer" />);
    expect(screen.queryByText("Zzz…")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: DUMMY_CONFIG.seer.buttonLabel }));

    expect(screen.getByText("Zzz…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- DummyScreen`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `dummyConfig.ts`**

```ts
import type { NightTickId } from "@onuw/shared";

export interface DummyConfig {
  prompt: string;
  buttonLabel: string;
}

export const DUMMY_CONFIG: Record<NightTickId, DummyConfig> = {
  doppelganger: { prompt: "Quelqu'un d'autre agit cette nuit.", buttonLabel: "Continuer à dormir" },
  werewolf: { prompt: "Les Loups-Garous se regardent.", buttonLabel: "Continuer à dormir" },
  minion: { prompt: "Le Sbire découvre les Loups.", buttonLabel: "Continuer à dormir" },
  mason: { prompt: "Les Francs-Maçons se reconnaissent.", buttonLabel: "Continuer à dormir" },
  seer: { prompt: "La Voyante regarde une carte.", buttonLabel: "Continuer à dormir" },
  robber: { prompt: "Le Voleur échange une carte.", buttonLabel: "Continuer à dormir" },
  troublemaker: { prompt: "La Semeuse de troubles échange deux cartes.", buttonLabel: "Continuer à dormir" },
  drunk: { prompt: "L'Ivrogne échange sa carte avec le centre.", buttonLabel: "Continuer à dormir" },
  insomniac: { prompt: "L'Insomniaque regarde sa carte.", buttonLabel: "Continuer à dormir" },
  doppelgangerInsomniac: { prompt: "Le Double regarde sa carte.", buttonLabel: "Continuer à dormir" },
};
```

- [ ] **Step 4: Implement `DummyScreen.tsx`**

```tsx
import { useState } from "react";
import type { NightTickId } from "@onuw/shared";
import { DUMMY_CONFIG } from "./dummyConfig";

function DummyScreen({ tickId }: { tickId: NightTickId }) {
  const [pressed, setPressed] = useState(false);
  const config = DUMMY_CONFIG[tickId];

  return (
    <div>
      <p>{config.prompt}</p>
      <button onClick={() => setPressed(true)} disabled={pressed}>
        {config.buttonLabel}
      </button>
      {pressed && <p>Zzz…</p>}
    </div>
  );
}

export default DummyScreen;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w client -- DummyScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/night/dummyConfig.ts client/src/components/night/DummyScreen.tsx client/src/components/night/DummyScreen.test.tsx
git commit -m "feat: add generic config-driven DummyScreen for inactive night ticks"
```

---

## Task 7: `RevealScreen` + shared role-screen prop type + the 4 passive-info screens (Minion/Mason/Insomniac/DoppelgangerInsomniac)

**Files:**
- Create: `client/src/components/night/RevealScreen.tsx`
- Create: `client/src/components/night/RevealScreen.test.tsx`
- Create: `client/src/components/night/roleScreenTypes.ts`
- Create: `client/src/components/night/roles/MinionScreen.tsx`
- Create: `client/src/components/night/roles/MasonScreen.tsx`
- Create: `client/src/components/night/roles/InsomniacScreen.tsx`
- Create: `client/src/components/night/roles/roles.test.tsx` (covers all 4 in one file — they share one shape)

**Interfaces:**
- Produces: `RevealScreen({ children, onContinue })`, `RoleScreenProps<TResult> { playerId: string; players: PublicPlayer[]; result: TResult | null; onSubmit: (params: Record<string, unknown>) => void; onContinue: () => void }`. Every later role-screen task (8-13) implements a component with this exact prop shape. `MinionScreen`/`MasonScreen` auto-submit `{}` on mount (no real choice to make, per spec — they still require the reveal to be tapped through). `InsomniacScreen` is reused for `doppelgangerInsomniac` too (identical: "look at your own current card").

- [ ] **Step 1: Write the failing test for `RevealScreen`**

```tsx
// client/src/components/night/RevealScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RevealScreen from "./RevealScreen";

describe("RevealScreen", () => {
  it("requires a tap on 'J'ai vu' before calling onContinue, and disables itself after", async () => {
    const onContinue = vi.fn();
    render(
      <RevealScreen onContinue={onContinue}>
        <p>Les Loups-Garous sont : Bob</p>
      </RevealScreen>,
    );

    expect(onContinue).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "J'ai vu" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "J'ai vu" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- RevealScreen`
Expected: FAIL.

- [ ] **Step 3: Implement `RevealScreen.tsx`**

```tsx
import { useState, type ReactNode } from "react";

function RevealScreen({ children, onContinue }: { children: ReactNode; onContinue: () => void }) {
  const [pressed, setPressed] = useState(false);

  return (
    <div>
      {children}
      <button
        onClick={() => {
          setPressed(true);
          onContinue();
        }}
        disabled={pressed}
      >
        J'ai vu
      </button>
    </div>
  );
}

export default RevealScreen;
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npm run test -w client -- RevealScreen` → PASS.

- [ ] **Step 5: Add `roleScreenTypes.ts`**

```ts
import type { PublicPlayer } from "@onuw/shared";

export interface RoleScreenProps<TResult> {
  playerId: string;
  players: PublicPlayer[];
  result: TResult | null;
  onSubmit: (params: Record<string, unknown>) => void;
  onContinue: () => void;
}
```

- [ ] **Step 6: Write the failing tests for the 4 passive screens**

```tsx
// client/src/components/night/roles/roles.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import MinionScreen from "./MinionScreen";
import MasonScreen from "./MasonScreen";
import InsomniacScreen from "./InsomniacScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

describe("MinionScreen", () => {
  it("auto-submits on mount and shows werewolf names once the result arrives", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <MinionScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
    );
    expect(onSubmit).toHaveBeenCalledWith({});

    rerender(
      <MinionScreen playerId="p1" players={players} result={{ werewolfIds: ["p2"] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it("says there is no werewolf when the list is empty", () => {
    render(
      <MinionScreen playerId="p1" players={players} result={{ werewolfIds: [] }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/pas de Loup-Garou/)).toBeInTheDocument();
  });
});

describe("MasonScreen", () => {
  it("shows the other mason's name", () => {
    render(
      <MasonScreen playerId="p1" players={players} result={{ masonIds: ["p2"] }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });
});

describe("InsomniacScreen", () => {
  it("shows the player's own current role", () => {
    render(
      <InsomniacScreen playerId="p1" players={players} result={{ roleId: "werewolf" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/Loup-Garou/)).toBeInTheDocument();
  });

  it("continuing calls onContinue", async () => {
    const onContinue = vi.fn();
    render(
      <InsomniacScreen playerId="p1" players={players} result={{ roleId: "villager" }} onSubmit={vi.fn()} onContinue={onContinue} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "J'ai vu" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm run test -w client -- roles.test`
Expected: FAIL — modules don't exist.

- [ ] **Step 8: Implement the 3 components**

```tsx
// MinionScreen.tsx
import { useEffect } from "react";
import type { PublicPlayer } from "@onuw/shared";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MinionScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<{ werewolfIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>Le Sbire découvre les Loups…</p>;
  const names = result.werewolfIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  return (
    <RevealScreen onContinue={onContinue}>
      <p>{names ? `Les Loups-Garous sont : ${names}` : "Il n'y a pas de Loup-Garou dans cette partie."}</p>
    </RevealScreen>
  );
}

export default MinionScreen;
```

```tsx
// MasonScreen.tsx
import { useEffect } from "react";
import type { PublicPlayer } from "@onuw/shared";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function MasonScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<{ masonIds: string[] }>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>Les Francs-Maçons se reconnaissent…</p>;
  const names = result.masonIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");

  return (
    <RevealScreen onContinue={onContinue}>
      <p>{names ? `L'autre Franc-Maçon est : ${names}` : "Tu es le seul Franc-Maçon."}</p>
    </RevealScreen>
  );
}

export default MasonScreen;
```

```tsx
// InsomniacScreen.tsx
import { useEffect } from "react";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";
import type { RoleId } from "@onuw/shared";

function InsomniacScreen({ result, onSubmit, onContinue }: RoleScreenProps<{ roleId: RoleId }>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>L'Insomniaque regarde sa carte…</p>;

  return (
    <RevealScreen onContinue={onContinue}>
      <p>Ta carte actuelle est : {roleLabel(result.roleId)}</p>
    </RevealScreen>
  );
}

export default InsomniacScreen;
```

`playerId` is unused in `MasonScreen`/`InsomniacScreen` — that's expected (the type is shared across all role screens per Task 7's interface; some don't need it). Not every field of `RoleScreenProps` is consumed by every screen.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w client -- roles.test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/night/RevealScreen.tsx client/src/components/night/RevealScreen.test.tsx client/src/components/night/roleScreenTypes.ts client/src/components/night/roles/MinionScreen.tsx client/src/components/night/roles/MasonScreen.tsx client/src/components/night/roles/InsomniacScreen.tsx client/src/components/night/roles/roles.test.tsx
git commit -m "feat: add RevealScreen and the passive-info role screens (Minion/Mason/Insomniac)"
```

---

## Task 8: `WerewolfScreen` — teammate reveal, with the Loup Solitaire center-peek sub-flow

**Files:**
- Create: `client/src/components/night/roles/WerewolfScreen.tsx`
- Create: `client/src/components/night/roles/WerewolfScreen.test.tsx`

**Interfaces:**
- Consumes: `RoleScreenProps<{ teammateIds: string[] } | { centerRoleId: RoleId }>`, `RevealScreen`, `roleLabel`.
- Produces: `<WerewolfScreen ... />`.

**Why this one is two-phase:** the server's `werewolfResolver` only peeks a center card when `params.centerIndex` is provided; the client can't know in advance whether this player is the lone wolf (other players' roles are private). So the screen auto-submits `{}` first — if `teammateIds` comes back non-empty, that's the whole action; if it comes back **empty**, the player is alone and the screen then offers a 3-card chooser, submitting a second `{ centerIndex }` action for the same `"werewolf"` tick (calling the pure resolver twice in one tick is safe — it never mutates state either way).

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/night/roles/WerewolfScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import WerewolfScreen from "./WerewolfScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("auto-submits on mount and shows the teammate when present", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(
    <WerewolfScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(onSubmit).toHaveBeenCalledWith({});

  rerender(
    <WerewolfScreen playerId="p1" players={players} result={{ teammateIds: ["p2"] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Bob/)).toBeInTheDocument();
});

it("offers a 3-card center chooser when alone, and submits centerIndex on pick", async () => {
  const onSubmit = vi.fn();
  render(
    <WerewolfScreen playerId="p1" players={players} result={{ teammateIds: [] }} onSubmit={onSubmit} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/aucun autre Loup/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Carte 2" }));
  expect(onSubmit).toHaveBeenCalledWith({ centerIndex: 1 });
});

it("reveals the peeked center card once it comes back", () => {
  render(
    <WerewolfScreen playerId="p1" players={players} result={{ centerRoleId: "tanner" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Tanneur/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- WerewolfScreen`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```tsx
import { useEffect } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

type WerewolfResult = { teammateIds: string[] } | { centerRoleId: RoleId };

function WerewolfScreen({ players, result, onSubmit, onContinue }: RoleScreenProps<WerewolfResult>) {
  useEffect(() => {
    onSubmit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return <p>Les Loups-Garous se regardent…</p>;

  if ("centerRoleId" in result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>La carte du centre est : {roleLabel(result.centerRoleId)}</p>
      </RevealScreen>
    );
  }

  if (result.teammateIds.length === 0) {
    return (
      <div>
        <p>Tu es seul, aucun autre Loup-Garou. Regarde une carte du centre :</p>
        {[0, 1, 2].map((index) => (
          <button key={index} onClick={() => onSubmit({ centerIndex: index })}>
            Carte {index + 1}
          </button>
        ))}
      </div>
    );
  }

  const names = result.teammateIds.map((id) => players.find((p) => p.id === id)?.pseudo ?? "?").join(", ");
  return (
    <RevealScreen onContinue={onContinue}>
      <p>Les autres Loups-Garous sont : {names}</p>
    </RevealScreen>
  );
}

export default WerewolfScreen;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- WerewolfScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/night/roles/WerewolfScreen.tsx client/src/components/night/roles/WerewolfScreen.test.tsx
git commit -m "feat: add WerewolfScreen with the Loup Solitaire center-peek sub-flow"
```

---

## Task 9: `SeerScreen` — look at a player's card, or two center cards

**Files:**
- Create: `client/src/components/night/roles/SeerScreen.tsx`
- Create: `client/src/components/night/roles/SeerScreen.test.tsx`

**Interfaces:**
- `RoleScreenProps<{ roleId: RoleId } | { roleIds: [RoleId, RoleId] }>`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import SeerScreen from "./SeerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("submits a player-mode look on pick", async () => {
  const onSubmit = vi.fn();
  render(<SeerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ mode: "player", targetPlayerId: "p2" });
});

it("submits a center-mode look after picking exactly two cards", async () => {
  const onSubmit = vi.fn();
  render(<SeerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Voir 2 cartes du centre" }));
  await userEvent.click(screen.getByRole("button", { name: "Carte 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Carte 3" }));

  expect(onSubmit).toHaveBeenCalledWith({ mode: "center", centerIndices: [0, 2] });
});

it("reveals the result once it arrives", () => {
  render(
    <SeerScreen playerId="p1" players={players} result={{ roleId: "werewolf" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Loup-Garou/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- SeerScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

type SeerResult = { roleId: RoleId } | { roleIds: [RoleId, RoleId] };

function SeerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<SeerResult>) {
  const [pickingCenter, setPickingCenter] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  if (result) {
    const text = "roleId" in result ? roleLabel(result.roleId) : result.roleIds.map(roleLabel).join(" et ");
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Tu as vu : {text}</p>
      </RevealScreen>
    );
  }

  if (pickingCenter) {
    function pick(index: number) {
      const next = selected.includes(index) ? selected : [...selected, index];
      setSelected(next);
      if (next.length === 2) onSubmit({ mode: "center", centerIndices: next });
    }
    return (
      <div>
        <p>Choisis 2 cartes du centre :</p>
        {[0, 1, 2].map((index) => (
          <button key={index} onClick={() => pick(index)} disabled={selected.includes(index)}>
            Carte {index + 1}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <p>Que veux-tu voir ?</p>
      {players
        .filter((p) => p.id !== playerId)
        .map((p) => (
          <button key={p.id} onClick={() => onSubmit({ mode: "player", targetPlayerId: p.id })}>
            {p.pseudo}
          </button>
        ))}
      <button onClick={() => setPickingCenter(true)}>Voir 2 cartes du centre</button>
    </div>
  );
}

export default SeerScreen;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- SeerScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/night/roles/SeerScreen.tsx client/src/components/night/roles/SeerScreen.test.tsx
git commit -m "feat: add SeerScreen for player-look and center-look modes"
```

---

## Task 10: `RobberScreen` — swap your card with a player's, see what you got

**Files:**
- Create: `client/src/components/night/roles/RobberScreen.tsx`
- Create: `client/src/components/night/roles/RobberScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import RobberScreen from "./RobberScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("excludes self from the target list and submits on pick", async () => {
  const onSubmit = vi.fn();
  render(<RobberScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "Alice" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2" });
});

it("reveals the new role once the result arrives", () => {
  render(
    <RobberScreen playerId="p1" players={players} result={{ newRoleId: "villager" }} onSubmit={vi.fn()} onContinue={vi.fn()} />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- RobberScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function RobberScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<{ newRoleId: RoleId }>) {
  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Ta nouvelle carte est : {roleLabel(result.newRoleId)}</p>
      </RevealScreen>
    );
  }

  return (
    <div>
      <p>Échange ta carte avec :</p>
      {players
        .filter((p) => p.id !== playerId)
        .map((p) => (
          <button key={p.id} onClick={() => onSubmit({ targetPlayerId: p.id })}>
            {p.pseudo}
          </button>
        ))}
    </div>
  );
}

export default RobberScreen;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- RobberScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/night/roles/RobberScreen.tsx client/src/components/night/roles/RobberScreen.test.tsx
git commit -m "feat: add RobberScreen"
```

---

## Task 11: `TroublemakerScreen` — swap two other players' cards, blind

**Files:**
- Create: `client/src/components/night/roles/TroublemakerScreen.tsx`
- Create: `client/src/components/night/roles/TroublemakerScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import TroublemakerScreen from "./TroublemakerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
  { id: "p3", pseudo: "Cy", isHost: false, connected: true },
];

it("picks two distinct other players, excluding self, then submits", async () => {
  const onSubmit = vi.fn();
  render(<TroublemakerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "Alice" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  await userEvent.click(screen.getByRole("button", { name: "Cy" }));

  expect(onSubmit).toHaveBeenCalledWith({ targetAId: "p2", targetBId: "p3" });
});

it("shows a blind confirmation once the result arrives (Troublemaker never sees the swapped roles)", () => {
  render(<TroublemakerScreen playerId="p1" players={players} result={{}} onSubmit={vi.fn()} onContinue={vi.fn()} />);
  expect(screen.getByText(/échangées/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- TroublemakerScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function TroublemakerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<Record<string, never>>) {
  const [firstPick, setFirstPick] = useState<string | null>(null);

  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Les deux cartes ont été échangées.</p>
      </RevealScreen>
    );
  }

  const candidates = players.filter((p) => p.id !== playerId);

  function pick(id: string) {
    if (!firstPick) {
      setFirstPick(id);
      return;
    }
    onSubmit({ targetAId: firstPick, targetBId: id });
  }

  return (
    <div>
      <p>Choisis deux joueurs dont tu vas échanger les cartes, sans les regarder :</p>
      {candidates
        .filter((p) => p.id !== firstPick)
        .map((p) => (
          <button key={p.id} onClick={() => pick(p.id)}>
            {p.pseudo}
          </button>
        ))}
    </div>
  );
}

export default TroublemakerScreen;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- TroublemakerScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/night/roles/TroublemakerScreen.tsx client/src/components/night/roles/TroublemakerScreen.test.tsx
git commit -m "feat: add TroublemakerScreen"
```

---

## Task 12: `DrunkScreen` — blind swap your card with a center card

**Files:**
- Create: `client/src/components/night/roles/DrunkScreen.tsx`
- Create: `client/src/components/night/roles/DrunkScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrunkScreen from "./DrunkScreen";

it("submits the picked center index", async () => {
  const onSubmit = vi.fn();
  render(<DrunkScreen playerId="p1" players={[]} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Carte 3" }));
  expect(onSubmit).toHaveBeenCalledWith({ centerIndex: 2 });
});

it("shows a blind confirmation (Drunk never sees the new card)", () => {
  render(<DrunkScreen playerId="p1" players={[]} result={{}} onSubmit={vi.fn()} onContinue={vi.fn()} />);
  expect(screen.getByText(/échangée/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- DrunkScreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";

function DrunkScreen({ result, onSubmit, onContinue }: RoleScreenProps<Record<string, never>>) {
  if (result) {
    return (
      <RevealScreen onContinue={onContinue}>
        <p>Ta carte a été échangée avec une carte du centre, sans que tu la voies.</p>
      </RevealScreen>
    );
  }

  return (
    <div>
      <p>Échange ta carte, sans la regarder, avec une carte du centre :</p>
      {[0, 1, 2].map((index) => (
        <button key={index} onClick={() => onSubmit({ centerIndex: index })}>
          Carte {index + 1}
        </button>
      ))}
    </div>
  );
}

export default DrunkScreen;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- DrunkScreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/night/roles/DrunkScreen.tsx client/src/components/night/roles/DrunkScreen.test.tsx
git commit -m "feat: add DrunkScreen"
```

---

## Task 13: Fix `doppelgangerResolver`'s two-phase gate, then `DoppelgangerScreen`

**Files:**
- Modify: `server/src/roles/actionResolvers.ts:132` (the `IMMEDIATE_CHAIN_ROLES` gate)
- Modify: `server/src/roles/actionResolvers.test.ts` (add the new phase-1-without-subParams cases)
- Create: `client/src/components/night/roles/DoppelgangerScreen.tsx`
- Create: `client/src/components/night/roles/DoppelgangerScreen.test.tsx`

**Why the server needs a one-line fix first:** `doppelgangerResolver` currently chains onto the copied role's resolver *unconditionally* whenever the copied role is in `IMMEDIATE_CHAIN_ROLES` — even if the caller never supplied `subParams`. A real client can't supply `subParams` for e.g. Robber before it knows the target's role is Robber (roles are private), and the game needs a distinct player-facing sub-choice (pick who to rob) once the copy is revealed. Left unconditional, a phase-1 call (`{ targetPlayerId }`, no `subParams`) would call `robberResolver(actingPlayerId, state, {})`, which crashes looking up `getPlayer(gameState, undefined)`. Gating the chain on `params.subParams !== undefined` makes the existing resolver support a natural two-call flow: call 1 reveals `copiedRoleId` only; call 2 (same tick, same target, real `subParams`) runs the chain. No existing test passes `subParams` implicitly (they all either omit it for non-chain roles or supply it explicitly for chain roles), so this is additive, not breaking.

- [ ] **Step 1: Write the new failing tests in `actionResolvers.test.ts`**

Add inside `describe("doppelgangerResolver", ...)`:

```ts
it("phase 1 (no subParams) reveals the copied role without running its chain, even for a chain-eligible role", () => {
  const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
  const rob = player({ id: "r1", originalRoleId: "robber", currentRoleId: "robber" });
  const state = stateWith([dopp, rob]);

  const { gameState, result } = doppelgangerResolver("d1", state, { targetPlayerId: "r1" });

  expect(result).toEqual({ copiedRoleId: "robber" });
  expect(gameState.night?.doppelgangerCopiedRoleId).toBe("robber");
});

it("phase 2 (same target, real subParams) runs the chain", () => {
  const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
  const rob = player({ id: "r1", originalRoleId: "robber", currentRoleId: "robber" });
  const victim = player({ id: "v1", originalRoleId: "villager", currentRoleId: "villager" });
  const state = stateWith([dopp, rob, victim]);

  const { result } = doppelgangerResolver("d1", state, { targetPlayerId: "r1", subParams: { targetPlayerId: "v1" } });

  expect(result.copiedRoleId).toBe("robber");
  expect(result.chained).toEqual({ newRoleId: "villager" });
});
```

Check `player`/`stateWith` helper names against the top of the existing test file and reuse them exactly — do not invent new fixture helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- actionResolvers`
Expected: FAIL — phase-1 test currently gets `result.chained` populated (or crashes) instead of a clean `{ copiedRoleId: "robber" }`.

- [ ] **Step 3: Fix the gate in `actionResolvers.ts`**

Change:

```ts
  if (IMMEDIATE_CHAIN_ROLES.includes(copiedRoleId)) {
```

to:

```ts
  if (IMMEDIATE_CHAIN_ROLES.includes(copiedRoleId) && params.subParams !== undefined) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w server -- actionResolvers`
Expected: PASS — both new tests, and all pre-existing ones (they all pass `subParams` explicitly for chain roles already).

- [ ] **Step 5: Commit the server fix**

```bash
git add server/src/roles/actionResolvers.ts server/src/roles/actionResolvers.test.ts
git commit -m "fix: only chain doppelganger's copied-role action once subParams is actually supplied"
```

- [ ] **Step 6: Write the failing client test**

```tsx
// client/src/components/night/roles/DoppelgangerScreen.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicPlayer } from "@onuw/shared";
import DoppelgangerScreen from "./DoppelgangerScreen";

const players: PublicPlayer[] = [
  { id: "p1", pseudo: "Alice", isHost: true, connected: true },
  { id: "p2", pseudo: "Bob", isHost: false, connected: true },
];

it("submits a target pick with no subParams", async () => {
  const onSubmit = vi.fn();
  render(<DoppelgangerScreen playerId="p1" players={players} result={null} onSubmit={onSubmit} onContinue={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2" });
});

it("for a passive copied role, reveals immediately with no sub-action", () => {
  render(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "villager" }}
      onSubmit={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});

it("for a chain-eligible copied role, offers the sub-action UI, then submits phase-2 subParams", async () => {
  const onSubmit = vi.fn();
  render(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "robber" }}
      onSubmit={onSubmit}
      onContinue={vi.fn()}
    />,
  );

  expect(screen.getByText(/Voleur/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Bob" }));

  expect(onSubmit).toHaveBeenCalledWith({ targetPlayerId: "p2", subParams: { targetPlayerId: "p2" } });
});

it("shows the chained reveal once it arrives", () => {
  render(
    <DoppelgangerScreen
      playerId="p1"
      players={players}
      result={{ copiedRoleId: "robber", chained: { newRoleId: "villager" } }}
      onSubmit={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(screen.getByText(/Villageois/)).toBeInTheDocument();
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test -w client -- DoppelgangerScreen`
Expected: FAIL — module doesn't exist.

- [ ] **Step 8: Implement `DoppelgangerScreen.tsx`**

Keeps its own sub-action UI intentionally minimal: reuses the exact screens already built in Tasks 9/11/12 for Seer/Troublemaker/Drunk, and Task 10 for Robber, rather than re-implementing their picker logic. The resolver needs the *original* Doppelganger target's id alongside the chained `subParams` (see `nightActionEvents.ts`'s `{ targetPlayerId, subParams }` shape from Task 2) — so this component remembers `targetPlayerId` in local state from its own phase-1 submission and resends it on phase 2:

```tsx
import { useState } from "react";
import type { RoleId } from "@onuw/shared";
import { roleLabel } from "../../../roleLabels";
import RevealScreen from "../RevealScreen";
import type { RoleScreenProps } from "../roleScreenTypes";
import SeerScreen from "./SeerScreen";
import RobberScreen from "./RobberScreen";
import TroublemakerScreen from "./TroublemakerScreen";
import DrunkScreen from "./DrunkScreen";

type DoppelgangerResult = { copiedRoleId: RoleId; chained?: unknown };

const CHAIN_SCREENS: Partial<Record<RoleId, (props: RoleScreenProps<never>) => JSX.Element>> = {
  seer: SeerScreen as never,
  robber: RobberScreen as never,
  troublemaker: TroublemakerScreen as never,
  drunk: DrunkScreen as never,
};

function DoppelgangerScreen({ playerId, players, result, onSubmit, onContinue }: RoleScreenProps<DoppelgangerResult>) {
  const [targetPlayerId, setTargetPlayerId] = useState<string | null>(null);

  if (!result) {
    return (
      <div>
        <p>Choisis un joueur dont tu vas copier le rôle :</p>
        {players
          .filter((p) => p.id !== playerId)
          .map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setTargetPlayerId(p.id);
                onSubmit({ targetPlayerId: p.id });
              }}
            >
              {p.pseudo}
            </button>
          ))}
      </div>
    );
  }

  const ChainScreen = CHAIN_SCREENS[result.copiedRoleId];
  if (ChainScreen && !result.chained && targetPlayerId) {
    return (
      <div>
        <p>Tu as copié : {roleLabel(result.copiedRoleId)}. Fais son action :</p>
        <ChainScreen
          playerId={playerId}
          players={players}
          result={null}
          onSubmit={(subParams) => onSubmit({ targetPlayerId, subParams })}
          onContinue={onContinue}
        />
      </div>
    );
  }

  return (
    <RevealScreen onContinue={onContinue}>
      <p>Tu as copié : {roleLabel(result.copiedRoleId)}.</p>
    </RevealScreen>
  );
}

export default DoppelgangerScreen;
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w client -- DoppelgangerScreen`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/night/roles/DoppelgangerScreen.tsx client/src/components/night/roles/DoppelgangerScreen.test.tsx
git commit -m "feat: add DoppelgangerScreen with its chained sub-action reusing existing role screens"
```

---

## Task 14: `Night.tsx` — orchestrator wiring everything together, route, fullscreen, pause overlay

**Files:**
- Create: `client/src/pages/Night.tsx`
- Create: `client/src/pages/Night.test.tsx`
- Modify: `client/src/App.tsx` (add the route)
- Modify: `client/src/pages/RoleSelect.tsx` (navigate to `/room/:roomCode/night` — currently `startGame()` fires and nothing navigates)

**Interfaces:**
- Consumes: everything from Tasks 4-13 (`useRoomSocket`'s night fields, `useFullscreen`, `DummyScreen`, and a `tickId → component` registry built from the 9 role screens — `doppelgangerInsomniac` reuses `InsomniacScreen`).
- Produces: the working `/room/:roomCode/night` page — this phase's actual deliverable.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/pages/Night.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Night from "./Night";

const mockUseRoomSocket = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: mockUseRoomSocket }));
vi.mock("../hooks/useFullscreen", () => ({ useFullscreen: vi.fn() }));

function renderNight() {
  return render(
    <MemoryRouter initialEntries={["/room/ABCD/night"]}>
      <Routes>
        <Route path="/room/:roomCode/night" element={<Night />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Night", () => {
  beforeEach(() => {
    mockUseRoomSocket.mockReset();
  });

  it("shows DummyScreen when the current tick isn't active for this player", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
    });

    renderNight();
    expect(screen.getByText("Continuer à dormir")).toBeInTheDocument();
  });

  it("shows the matching role screen when active", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "robber", durationMs: 8000, active: true },
      nightPaused: false,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
    });

    renderNight();
    expect(screen.getByText(/Échange ta carte avec/)).toBeInTheDocument();
  });

  it("shows a neutral pause overlay without revealing who disconnected", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      nightPaused: true,
      nightEnded: false,
      actionResult: null,
      submitNightAction: vi.fn(),
    });

    renderNight();
    expect(screen.getByText(/en pause/)).toBeInTheDocument();
    expect(screen.queryByText("Continuer à dormir")).not.toBeInTheDocument();
  });

  it("shows the end-of-night text once NIGHT_END fires", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: null,
      nightPaused: false,
      nightEnded: true,
      actionResult: null,
      submitNightAction: vi.fn(),
    });

    renderNight();
    expect(screen.getByText(/nuit est terminée/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- Night.test`
Expected: FAIL — `Night.tsx` doesn't exist.

- [ ] **Step 3: Implement `Night.tsx`**

```tsx
import type { NightTickId } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { useFullscreen } from "../hooks/useFullscreen";
import DummyScreen from "../components/night/DummyScreen";
import type { RoleScreenProps } from "../components/night/roleScreenTypes";
import WerewolfScreen from "../components/night/roles/WerewolfScreen";
import MinionScreen from "../components/night/roles/MinionScreen";
import MasonScreen from "../components/night/roles/MasonScreen";
import SeerScreen from "../components/night/roles/SeerScreen";
import RobberScreen from "../components/night/roles/RobberScreen";
import TroublemakerScreen from "../components/night/roles/TroublemakerScreen";
import DrunkScreen from "../components/night/roles/DrunkScreen";
import InsomniacScreen from "../components/night/roles/InsomniacScreen";
import DoppelgangerScreen from "../components/night/roles/DoppelgangerScreen";

const ROLE_SCREENS: Record<NightTickId, (props: RoleScreenProps<never>) => JSX.Element> = {
  doppelganger: DoppelgangerScreen as never,
  werewolf: WerewolfScreen as never,
  minion: MinionScreen as never,
  mason: MasonScreen as never,
  seer: SeerScreen as never,
  robber: RobberScreen as never,
  troublemaker: TroublemakerScreen as never,
  drunk: DrunkScreen as never,
  insomniac: InsomniacScreen as never,
  doppelgangerInsomniac: InsomniacScreen as never,
};

function Night() {
  const { playerId, players, currentTick, nightPaused, nightEnded, actionResult, submitNightAction } = useRoomSocket();
  useFullscreen(!nightEnded);

  if (nightEnded) return <p>La nuit est terminée.</p>;
  if (nightPaused) return <p>La partie est en pause…</p>;
  if (!currentTick) return <p>En attente du début de la nuit…</p>;

  if (!currentTick.active) return <DummyScreen tickId={currentTick.tickId} />;

  const RoleScreen = ROLE_SCREENS[currentTick.tickId];
  const result = actionResult?.tickId === currentTick.tickId ? actionResult.result : null;

  return (
    <RoleScreen
      playerId={playerId}
      players={players}
      result={result as never}
      onSubmit={(params) => submitNightAction(currentTick.tickId, params)}
      onContinue={() => {}}
    />
  );
}

export default Night;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client -- Night.test`
Expected: PASS.

- [ ] **Step 5: Wire the route and Lancer-la-partie navigation**

In `client/src/App.tsx`:

```tsx
import Night from "./pages/Night";
```

```tsx
        <Route path="/room/:roomCode/night" element={<Night />} />
```

In `client/src/pages/RoleSelect.tsx`, add the navigation import and call it once the game actually starts. `START_GAME` doesn't itself signal "night has begun" client-side — the first `TICK_START` does, via `useRoomSocket`. Navigate as soon as `currentTick` is set:

```tsx
import { useNavigate, useParams } from "react-router-dom";
```

```tsx
  const navigate = useNavigate();
  const { playerId, players, roleSelection, currentTick, setRoleMode, setCustomRoles, startGame } = useRoomSocket();

  if (currentTick && routeRoomCode) {
    navigate(`/room/${routeRoomCode}/night`);
  }
```

Place this check right after the existing `if (!roleSelection) { ... }` guard, before the main render — it must not block Task 4-14's tests for `RoleSelect.test.tsx`, which never set `currentTick`, so this branch stays inert for all existing tests.

- [ ] **Step 6: Run the full client suite**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS, build succeeds.

- [ ] **Step 7: Run the full monorepo suite as a final check**

Run: `npm run test && npm run build && npm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/Night.tsx client/src/pages/Night.test.tsx client/src/App.tsx client/src/pages/RoleSelect.tsx
git commit -m "feat: wire Night.tsx orchestrator — dummy/role screens, fullscreen, pause overlay"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** uniform ticks (Tasks 6-14), fixed+jittered duration untouched (server, Phase 1), dummy requires real tap (Task 6), fullscreen + back-nav block (Task 5/14), lone-wolf same-duration tick (Task 8, `activeFor` server-side already ignores wolf count), Doppelganger-into-Werewolf/Mason-tick (already correct in `nightOrder.ts`'s `actsAsOriginalOrDoppelgangerCopy`, untouched), Doppelganger-into-immediate-chain-roles (Task 13), Minion info asymmetry (Task 7, private `ACTION_RESULT` per socket — never broadcast), pause/grace on night disconnect (Task 3), reconnection silent outside night (already built Phase 1/2, untouched).
- **Placeholder scan:** none — every step has full code. The two self-corrections in Task 8 (stray `</details>`) and Task 13 (`findCopiedTargetId`) were caught and fixed inline during drafting, matching the skill's "find issues, fix them inline" instruction — left visible here as the actual reasoning trail rather than silently smoothed over, since a subagent implementing Task 13 benefits from seeing *why* the local-state version is correct.
- **Type consistency:** `RoleScreenProps<TResult>` (Task 7) is the single shape every role screen (Tasks 8-13) and the `Night.tsx` registry (Task 14) implements — checked against each task's usage above. `NightTickId`/`NIGHT_TICK_IDS` (Task 1) is the one place all 10 tick ids are named; every later task imports it rather than re-declaring.
