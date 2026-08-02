# ONUW Phase 5 — Day & Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DAY and VOTE phases end-to-end — a host-configurable discussion timer that starts automatically when the night ends, and a simultaneous-reveal vote that transitions the room into REVEAL once every player has voted.

**Architecture:** Mirrors the existing NIGHT tick-runner pattern (Phase 1/4): timer authority lives in Redis (`GameState.day`), never in a local `setTimeout` alone — a `scheduleAdvance`-style callback is injected for testability and a stale-token guard protects against races exactly like `tickRunner.ts` already does. The vote is a pure `resolveVotes` function fed by a Redis-backed `GameState.vote.votes` map, following the same `withRoom` CAS pattern already used by every other mutating socket handler in this codebase. Client pages (`Day.tsx`, `Vote.tsx`) follow the same "socket event flips a piece of `useRoomSocket` state → a `useEffect` in the *previous* page notices it and navigates forward" chain already used for Lobby→RoleSelect→Night.

**Tech Stack:** TypeScript strict, Socket.io, Redis (ioredis) via the existing `roomStore.ts`/`withRoom` helpers, Zod for payload validation, Vitest + Testing Library, React Router.

## Global Constraints

- Day timer: fixed duration set by the host **before** the game (not mid-discussion), default 4 minutes, adjustable in the range 1–10 minutes (spec's example is "3-5 min ajustable par le host avant la partie" — this plan implements the adjustable part with a slightly wider technical bound; the UI default matches the spec's range).
- The app **never intervenes in the discussion itself** — Day is a timer only, no forced actions.
- Vote: "gros boutons avec les pseudos/avatars, un tap = un vote, résultat révélé en même temps pour tout le monde" — no partial tallies are ever broadcast before every player has voted (same anti-tell posture as the night ticks: nothing leaks before the reveal instant).
- Reconnection during LOBBY/DAY/VOTE is silent (no pause, no grace period) — that machinery is reserved for NIGHT ticks only (already implemented in `disconnectHandler.ts`, out of scope here). Day/Vote just need reconnect **catch-up** (re-send the current state so a refreshed client lands on the right screen), not pause/resume.
- Server is authoritative: phase transitions (`DAY → VOTE → REVEAL`) already exist in `server/src/state/phases.ts` and are reused as-is, not modified.
- This phase stops at computing the vote tally and the eliminated player(s) and transitioning to `REVEAL`. Win-condition computation (Village/Loups/Tanner/Hunter chains) and the `Reveal.tsx` page are explicitly Phase 6's responsibility — do not build them here.
- TypeScript note specific to this repo: `server/tsconfig.json` and `shared/tsconfig.json` both `exclude: ["src/**/*.test.ts"]`, and `npm run test` runs under Vitest (no type-checking pass) — so **server/shared test fixtures are not type-checked by the build**. `client/tsconfig.app.json` has no such exclusion, and `client`'s build script is `tsc -b && vite build` — **client test fixtures ARE type-checked**. This is why this plan updates every client-side `RoomSession` mock fixture it touches, but does not need to touch server/shared test fixtures beyond the ones a task's own tests require.

---

## Task 1: Shared day/vote contracts (`shared/src/types.ts`)

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`
- Modify: `server/src/rooms/roomEvents.ts:123-134` (the `CREATE_ROOM` handler's initial `GameState` literal — the only production-code fixture that must reflect new required fields immediately, since `dayTimer.startDay` reads `room.dayDurationMs` at runtime from Task 2 onward)

**Interfaces:**
- Produces: `DEFAULT_DAY_DURATION_MS`, `MIN_DAY_DURATION_MS`, `MAX_DAY_DURATION_MS` (numbers, ms), `DayState { startedAt: number; durationMs: number }`, `VoteState { votes: Record<string, string> }` (voterId → targetPlayerId), `GameState.dayDurationMs: number`, `GameState.day: DayState | null`, `GameState.vote: VoteState | null`, and 5 new events: `ServerToClientEvents.DAY_DURATION_UPDATE`, `.DAY_START`, `.VOTE_START`, `.VOTE_RESULT`; `ClientToServerEvents.SET_DAY_DURATION`, `.SUBMIT_VOTE`.

- [ ] **Step 1: Write the failing test**

Add to `shared/src/types.test.ts`, right after the existing `describe("night event contracts", ...)` block:

```typescript
describe("day/vote event contracts", () => {
  it("exposes the day duration bounds and a sane default within them", () => {
    expect(DEFAULT_DAY_DURATION_MS).toBeGreaterThanOrEqual(MIN_DAY_DURATION_MS);
    expect(DEFAULT_DAY_DURATION_MS).toBeLessThanOrEqual(MAX_DAY_DURATION_MS);
  });

  it("GameState carries dayDurationMs, a nullable day timer, and a nullable vote map", () => {
    const state: GameState = {
      roomCode: "ABCD",
      phase: "DAY",
      players: [],
      center: [],
      night: null,
      day: { startedAt: 1000, durationMs: 240_000 },
      vote: null,
      roleSelection: null,
      dayDurationMs: DEFAULT_DAY_DURATION_MS,
      createdAt: 0,
      updatedAt: 0,
    };

    expect(state.day?.durationMs).toBe(240_000);
    expect(state.vote).toBeNull();
  });

  it("wires SET_DAY_DURATION/DAY_DURATION_UPDATE/DAY_START/VOTE_START/VOTE_RESULT/SUBMIT_VOTE", () => {
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
      DAY_DURATION_UPDATE: () => {},
      DAY_START: () => {},
      VOTE_START: () => {},
      VOTE_RESULT: () => {},
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
      SET_DAY_DURATION: () => {},
      SUBMIT_VOTE: () => {},
    };

    serverEvents.DAY_START({ durationMs: 240_000 });
    serverEvents.VOTE_RESULT({ tally: { p1: 2, p2: 1 }, eliminated: ["p1"] });
    clientEvents.SUBMIT_VOTE({ targetPlayerId: "p1" });
    expect(typeof clientEvents.SET_DAY_DURATION).toBe("function");
  });
});
```

Add `DEFAULT_DAY_DURATION_MS`, `MIN_DAY_DURATION_MS`, `MAX_DAY_DURATION_MS` to the existing `import { ROLE_IDS, isValidRoleId, NIGHT_TICK_IDS } from "./types";` line (turn it into a named import list that also pulls these three).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `DEFAULT_DAY_DURATION_MS is not defined` / `GameState` missing `day`/`vote`/`dayDurationMs` / events missing on the two interfaces.

- [ ] **Step 3: Write minimal implementation**

In `shared/src/types.ts`, add near the top (after the `RoomPhase`/`GameMode` block, before `Player`):

```typescript
export const DEFAULT_DAY_DURATION_MS = 4 * 60 * 1000;
export const MIN_DAY_DURATION_MS = 60 * 1000;
export const MAX_DAY_DURATION_MS = 10 * 60 * 1000;
```

Add two new interfaces right after `NightState`:

```typescript
export interface DayState {
  startedAt: number;
  durationMs: number;
}

export interface VoteState {
  votes: Record<string, string>;
}
```

Extend `GameState`:

```typescript
export interface GameState {
  roomCode: string;
  phase: RoomPhase;
  players: Player[];
  center: RoleId[];
  night: NightState | null;
  day: DayState | null;
  vote: VoteState | null;
  roleSelection: RoleSelection | null;
  dayDurationMs: number;
  createdAt: number;
  updatedAt: number;
}
```

Extend `ServerToClientEvents`:

```typescript
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
  DAY_DURATION_UPDATE: (payload: { durationMs: number }) => void;
  DAY_START: (payload: { durationMs: number }) => void;
  VOTE_START: (payload: Record<string, never>) => void;
  VOTE_RESULT: (payload: { tally: Record<string, number>; eliminated: string[] }) => void;
}
```

Extend `ClientToServerEvents`:

```typescript
export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
  SUBMIT_NIGHT_ACTION: (payload: { tickId: NightTickId; params: Record<string, unknown> }) => void;
  SET_DAY_DURATION: (payload: { durationMs: number }) => void;
  SUBMIT_VOTE: (payload: { targetPlayerId: string }) => void;
}
```

Now update the one production `GameState` literal that must stay valid: in `server/src/rooms/roomEvents.ts`, the `CREATE_ROOM` handler builds:

```typescript
const candidate: GameState = {
  roomCode,
  phase: "LOBBY",
  players: [
    { id: playerId, pseudo: parsed.data.pseudo, isHost: true, connected: true, reconnectToken },
  ],
  center: [],
  night: null,
  roleSelection: null,
  createdAt: now,
  updatedAt: now,
};
```

Add the three new fields and import `DEFAULT_DAY_DURATION_MS`:

```typescript
import { validateRoleSelection, DEFAULT_DAY_DURATION_MS } from "@onuw/shared";
```

```typescript
const candidate: GameState = {
  roomCode,
  phase: "LOBBY",
  players: [
    { id: playerId, pseudo: parsed.data.pseudo, isHost: true, connected: true, reconnectToken },
  ],
  center: [],
  night: null,
  day: null,
  vote: null,
  roleSelection: null,
  dayDurationMs: DEFAULT_DAY_DURATION_MS,
  createdAt: now,
  updatedAt: now,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: add day/vote GameState fields and socket event contracts"
```

---

## Task 2: `server/src/day/dayTimer.ts` — day-phase timer authority

**Files:**
- Create: `server/src/day/dayTimer.ts`
- Test: `server/src/day/dayTimer.test.ts`

**Interfaces:**
- Consumes: `GameState`, `getRoom`/`saveRoom`/`createRoom` from `../rooms/roomStore.js`, `transition` from `../state/phases.js` (all already exist).
- Produces: `createDayTimer(deps: DayTimerDeps): { startDay(roomCode: string): Promise<void>; endDay(roomCode: string, expectedStartedAt?: number): Promise<void> }`, where `DayTimerDeps = { broadcast: (roomCode: string, event: string, payload: unknown) => void; scheduleAdvance?: (roomCode: string, delayMs: number, token: number) => void }`. Task 3 wires `startDay` as the night's `onNightEnd` callback and `endDay`'s stale-token guard mirrors `tickRunner.ts`'s `advanceTick` exactly (token = the day's `startedAt` timestamp).

- [ ] **Step 1: Write the failing test**

Create `server/src/day/dayTimer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom } from "../rooms/roomStore.js";
import { createDayTimer } from "./dayTimer.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "NIGHT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
    ],
    center: [],
    night: null,
    day: null,
    vote: null,
    roleSelection: null,
    dayDurationMs: 200,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("dayTimer", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("startDay reads dayDurationMs off the room, saves day state, and broadcasts DAY_START", async () => {
    await createRoom(fixture("ABCD"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance });

    await timer.startDay("ABCD");

    const room = await getRoom("ABCD");
    expect(room?.day?.durationMs).toBe(200);
    expect(broadcast).toHaveBeenCalledWith("ABCD", "DAY_START", { durationMs: 200 });
    expect(scheduleAdvance).toHaveBeenCalledWith("ABCD", 200, expect.any(Number));
  });

  it("endDay transitions DAY to VOTE, clears day, opens an empty vote, and broadcasts VOTE_START", async () => {
    await createRoom(fixture("EFGH"));
    const broadcast = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance: vi.fn() });

    await timer.startDay("EFGH");
    await timer.endDay("EFGH");

    const room = await getRoom("EFGH");
    expect(room?.phase).toBe("VOTE");
    expect(room?.day).toBeNull();
    expect(room?.vote).toEqual({ votes: {} });
    expect(broadcast).toHaveBeenCalledWith("EFGH", "VOTE_START", {});
  });

  it("a stale endDay token (armed before a fresh startDay) is a safe no-op", async () => {
    await createRoom(fixture("STALE"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const timer = createDayTimer({ broadcast, scheduleAdvance });

    await timer.startDay("STALE");
    const staleToken = scheduleAdvance.mock.calls[0][2] as number;

    let room = await getRoom("STALE");
    await saveRoom({ ...room!, day: { startedAt: Date.now(), durationMs: 200 } });

    await timer.endDay("STALE", staleToken);
    room = await getRoom("STALE");
    expect(room?.phase).toBe("NIGHT");
    expect(room?.day).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- dayTimer`
Expected: FAIL — `Cannot find module './dayTimer.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/day/dayTimer.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- dayTimer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/day/dayTimer.ts server/src/day/dayTimer.test.ts
git commit -m "feat: add dayTimer with Redis-authoritative start/end and stale-token guard"
```

---

## Task 3: Wire night-end into the day timer

**Files:**
- Modify: `server/src/night/tickRunner.ts`
- Modify: `server/src/night/tickRunner.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `createDayTimer` from Task 2.
- Produces: `TickRunnerDeps.onNightEnd?: (roomCode: string) => Promise<void> | void`, called once, right after the existing `NIGHT_END` broadcast, whenever `advanceTick` runs past the last night tick.

- [ ] **Step 1: Write the failing test**

Add to `server/src/night/tickRunner.test.ts`, inside the existing `describe("tickRunner", ...)` block, right after the `"advanceTick past the last tick ends the night and moves to DAY"` test:

```typescript
  it("advanceTick past the last tick calls onNightEnd with the room code", async () => {
    await createRoom(fixture("ONEND"));
    const onNightEnd = vi.fn();
    const runner = createTickRunner({
      broadcast: vi.fn(),
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      onNightEnd,
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("ONEND");
    await runner.advanceTick("ONEND");
    await runner.advanceTick("ONEND");

    expect(onNightEnd).toHaveBeenCalledWith("ONEND");
  });

  it("advanceTick past the last tick without onNightEnd configured still ends the night", async () => {
    await createRoom(fixture("NOEND"));
    const runner = createTickRunner({
      broadcast: vi.fn(),
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("NOEND");
    await runner.advanceTick("NOEND");
    await expect(runner.advanceTick("NOEND")).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- tickRunner`
Expected: FAIL — `onNightEnd` is not a known property of the deps object passed to `createTickRunner` is silently accepted by JS but the first new test's `expect(onNightEnd).toHaveBeenCalledWith(...)` fails because nothing ever calls it.

- [ ] **Step 3: Write minimal implementation**

In `server/src/night/tickRunner.ts`, add `onNightEnd` to `TickRunnerDeps`:

```typescript
export interface TickRunnerDeps {
  broadcast: (roomCode: string, event: string, payload: unknown) => void;
  emitToPlayer: (playerId: string, event: string, payload: unknown) => void;
  nightOrder?: NightTick[];
  jitterMs?: number;
  scheduleAdvance?: (roomCode: string, delayMs: number, token: number) => void;
  onNightEnd?: (roomCode: string) => Promise<void> | void;
}
```

In `advanceTick`, call it right after the existing `NIGHT_END` broadcast:

```typescript
    if (nextIndex >= nightOrder.length) {
      const updated: GameState = { ...transition(room, "DAY"), night: null };
      await saveRoom(updated);
      deps.broadcast(roomCode, "NIGHT_END", {});
      await deps.onNightEnd?.(roomCode);
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- tickRunner`
Expected: PASS

- [ ] **Step 5: Wire it in `server/src/index.ts`**

Replace the `tickRunner` construction block:

```typescript
  const tickRunner = createTickRunner({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    emitToPlayer: (playerId, event, payload) => {
      (io.to(playerId) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
  });
```

with:

```typescript
  const dayTimer = createDayTimer({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
  });

  const tickRunner = createTickRunner({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    emitToPlayer: (playerId, event, payload) => {
      (io.to(playerId) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    onNightEnd: (roomCode) => dayTimer.startDay(roomCode),
  });
```

Add the import at the top of `server/src/index.ts`:

```typescript
import { createDayTimer } from "./day/dayTimer.js";
```

- [ ] **Step 6: Run the whole server suite**

Run: `npm run test -w server`
Expected: PASS (no test directly exercises `index.ts`'s wiring — this step is a manual sanity check that nothing else broke)

- [ ] **Step 7: Commit**

```bash
git add server/src/night/tickRunner.ts server/src/night/tickRunner.test.ts server/src/index.ts
git commit -m "feat: start the day timer automatically when the night tick sequence ends"
```

---

## Task 4: `SET_DAY_DURATION` — host configures the day timer before the game

**Files:**
- Create: `server/src/day/dayDurationEvents.ts`
- Test: `server/src/day/dayDurationEvents.test.ts`
- Modify: `server/src/rooms/roomEvents.ts`

**Interfaces:**
- Consumes: `Membership` type from `../rooms/roleSelectEvents.js`, `withRoom` from `../rooms/roomStore.js`, `MIN_DAY_DURATION_MS`/`MAX_DAY_DURATION_MS` from `@onuw/shared`.
- Produces: `registerDayDurationEvents(io, socket, getMembership): void` and `broadcastDayDuration(io, state): void`, both consumed by `registerRoomEvents` in `roomEvents.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/src/day/dayDurationEvents.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerDayDurationEvents } from "./dayDurationEvents.js";

function fixture(roomCode: string, overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode,
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
    ],
    center: [],
    night: null,
    day: null,
    vote: null,
    roleSelection: { mode: "classic", roles: {} },
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    trigger: (event: string, payload: unknown) => handlers.get(event)!(payload),
    emitted,
  };
}

describe("registerDayDurationEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("lets the host set a valid duration and broadcasts DAY_DURATION_UPDATE to the room", async () => {
    await createRoom(fixture("ABCD"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const toSpy = vi.fn(() => ({ emit: vi.fn() }));
    io.to = toSpy;
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }));

    socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });
    await new Promise((r) => setTimeout(r, 0));

    const room = await getRoom("ABCD");
    expect(room?.dayDurationMs).toBe(180_000);
    expect(toSpy).toHaveBeenCalledWith("ABCD");
  });

  it("rejects a non-host", async () => {
    await createRoom(fixture("EFGH"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "EFGH", playerId: "p2" }));

    socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });
    await new Promise((r) => setTimeout(r, 0));

    const room = await getRoom("EFGH");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "seul l'hôte peut faire cette action" } });
  });

  it("rejects a duration outside the allowed bounds", async () => {
    await createRoom(fixture("IJKL"));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "IJKL", playerId: "p1" }));

    socket.trigger("SET_DAY_DURATION", { durationMs: 999_999_999 });
    await new Promise((r) => setTimeout(r, 0));

    const room = await getRoom("IJKL");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "durée de jour invalide" } });
  });

  it("rejects the change once the room has left ROLE_SELECT", async () => {
    await createRoom(fixture("MNOP", { phase: "NIGHT", roleSelection: null }));
    const io = { to: () => ({ emit: vi.fn() }) };
    const socket = fakeSocket();
    registerDayDurationEvents(io as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }));

    socket.trigger("SET_DAY_DURATION", { durationMs: 180_000 });
    await new Promise((r) => setTimeout(r, 0));

    const room = await getRoom("MNOP");
    expect(room?.dayDurationMs).toBe(240_000);
    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "action impossible dans la phase actuelle de la partie" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- dayDurationEvents`
Expected: FAIL — `Cannot find module './dayDurationEvents.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/day/dayDurationEvents.ts`:

```typescript
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const setDayDurationSchema = z.object({
  durationMs: z.number().int().min(MIN_DAY_DURATION_MS).max(MAX_DAY_DURATION_MS),
});

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "durée de jour invalide";
}

export function broadcastDayDuration(io: AppServer, state: GameState): void {
  io.to(state.roomCode).emit("DAY_DURATION_UPDATE", { durationMs: state.dayDurationMs });
}

export function registerDayDurationEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("SET_DAY_DURATION", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = setDayDurationSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "durée de jour invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT") throw new WrongPhaseError();
          return { ...room, dayDurationMs: parsed.data.durationMs, updatedAt: Date.now() };
        });
        broadcastDayDuration(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- dayDurationEvents`
Expected: PASS

- [ ] **Step 5: Wire it into `roomEvents.ts`**

Add the import:

```typescript
import { registerDayDurationEvents, broadcastDayDuration } from "../day/dayDurationEvents.js";
```

At the bottom of `registerRoomEvents`, alongside the existing wiring:

```typescript
  registerRoleSelectEvents(io, socket, () => membership, tickRunner);
  registerNightActionEvents(io, socket, () => membership);
  registerDayDurationEvents(io, socket, () => membership);
```

In the reconnect block (the `void (async () => { ... })()` right after the handshake-auth check), add a catch-up emit right after `await broadcastRoster(io, state);`:

```typescript
        await broadcastRoster(io, state);
        socket.emit("DAY_DURATION_UPDATE", { durationMs: state.dayDurationMs });
```

- [ ] **Step 6: Run the whole server suite**

Run: `npm run test -w server`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/day/dayDurationEvents.ts server/src/day/dayDurationEvents.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: let the host configure the day timer duration before the game"
```

---

## Task 5: `server/src/state/voteResolver.ts` — pure tally + tie-elimination logic

**Files:**
- Create: `server/src/state/voteResolver.ts`
- Test: `server/src/state/voteResolver.test.ts`

**Interfaces:**
- Produces: `VoteResult { tally: Record<string, number>; eliminated: string[] }`, `resolveVotes(votes: Record<string, string>, playerIds: string[]): VoteResult`. Consumed by Task 6's `voteEvents.ts`.
- Rule: official ONUW rule — every player tied for the most votes is eliminated (a tie doesn't mean "no one dies", it means everyone at the max dies). Every player who voted (or wasn't voted for) still appears in `tally` with a count, defaulting to 0.

- [ ] **Step 1: Write the failing test**

Create `server/src/state/voteResolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveVotes } from "./voteResolver.js";

describe("resolveVotes", () => {
  it("eliminates the single player with the most votes", () => {
    const result = resolveVotes({ p1: "p2", p2: "p2", p3: "p1" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 1, p2: 2, p3: 0 });
    expect(result.eliminated).toEqual(["p2"]);
  });

  it("eliminates every player tied for the most votes", () => {
    const result = resolveVotes({ p1: "p2", p2: "p1", p3: "p1" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 2, p2: 1, p3: 0 });
    expect(result.eliminated).toEqual(["p1"]);
  });

  it("eliminates a 2-way tie for the max", () => {
    const result = resolveVotes({ p1: "p2", p2: "p1" }, ["p1", "p2"]);
    expect(result.tally).toEqual({ p1: 1, p2: 1 });
    expect(result.eliminated.sort()).toEqual(["p1", "p2"]);
  });

  it("includes every player id in the tally even with zero votes", () => {
    const result = resolveVotes({ p1: "p2" }, ["p1", "p2", "p3"]);
    expect(result.tally).toEqual({ p1: 0, p2: 1, p3: 0 });
  });

  it("returns no eliminations when there are no votes at all", () => {
    const result = resolveVotes({}, ["p1", "p2"]);
    expect(result.tally).toEqual({ p1: 0, p2: 0 });
    expect(result.eliminated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- voteResolver`
Expected: FAIL — `Cannot find module './voteResolver.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/state/voteResolver.ts`:

```typescript
export interface VoteResult {
  tally: Record<string, number>;
  eliminated: string[];
}

export function resolveVotes(votes: Record<string, string>, playerIds: string[]): VoteResult {
  const tally: Record<string, number> = {};
  for (const id of playerIds) tally[id] = 0;
  for (const targetId of Object.values(votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  const counts = Object.values(tally);
  const maxVotes = counts.length > 0 ? Math.max(...counts) : 0;
  const eliminated = maxVotes > 0 ? playerIds.filter((id) => tally[id] === maxVotes) : [];

  return { tally, eliminated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- voteResolver`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/state/voteResolver.ts server/src/state/voteResolver.test.ts
git commit -m "feat: add resolveVotes with official tie-elimination rule"
```

---

## Task 6: `SUBMIT_VOTE` — collect votes, resolve once everyone's in, transition to REVEAL

**Files:**
- Create: `server/src/day/voteEvents.ts`
- Test: `server/src/day/voteEvents.test.ts`
- Modify: `server/src/rooms/roomEvents.ts`

**Interfaces:**
- Consumes: `resolveVotes` from Task 5, `withRoom` from `../rooms/roomStore.js`, `transition` from `../state/phases.js`, `Membership` from `../rooms/roleSelectEvents.js`.
- Produces: `registerVoteEvents(io, socket, getMembership): void`, wired into `registerRoomEvents`.
- A player may change their vote any time before the room finishes (re-submitting overwrites their own entry in `vote.votes`, doesn't change the "have they voted" count).
- `VOTE_RESULT` is only ever broadcast once — the instant the last player's vote arrives — never a partial tally.

- [ ] **Step 1: Write the failing test**

Create `server/src/day/voteEvents.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerVoteEvents } from "./voteEvents.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "VOTE",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true, reconnectToken: "t3" },
    ],
    center: [],
    night: null,
    day: null,
    vote: { votes: {} },
    roleSelection: null,
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    trigger: async (event: string, payload: unknown) => {
      handlers.get(event)!(payload);
      await new Promise((r) => setTimeout(r, 0));
    },
    emitted,
  };
}

function fakeIo() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  return {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
    }),
    emitted,
  };
}

describe("registerVoteEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("records a vote without resolving until every player has voted", async () => {
    await createRoom(fixture("ABCD"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "ABCD", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });

    const room = await getRoom("ABCD");
    expect(room?.phase).toBe("VOTE");
    expect(room?.vote?.votes).toEqual({ p1: "p2" });
    expect(io.emitted.some((e) => e.event === "VOTE_RESULT")).toBe(false);
  });

  it("resolves and broadcasts VOTE_RESULT exactly once the last vote arrives, and transitions to REVEAL", async () => {
    await createRoom(fixture("EFGH"));
    const io = fakeIo();
    const s1 = fakeSocket();
    const s2 = fakeSocket();
    const s3 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "EFGH", playerId: "p1" }));
    registerVoteEvents(io as never, s2 as never, () => ({ roomCode: "EFGH", playerId: "p2" }));
    registerVoteEvents(io as never, s3 as never, () => ({ roomCode: "EFGH", playerId: "p3" }));

    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    await s2.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    expect(io.emitted.some((e) => e.event === "VOTE_RESULT")).toBe(false);

    await s3.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });

    const room = await getRoom("EFGH");
    expect(room?.phase).toBe("REVEAL");
    expect(room?.vote).toBeNull();
    const resultEvent = io.emitted.find((e) => e.event === "VOTE_RESULT");
    expect(resultEvent?.payload).toEqual({ tally: { p1: 1, p2: 2, p3: 0 }, eliminated: ["p2"] });
  });

  it("a re-submitted vote overwrites the voter's previous choice without counting twice", async () => {
    await createRoom(fixture("IJKL"));
    const io = fakeIo();
    const s1 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "IJKL", playerId: "p1" }));

    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });
    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p3" });

    const room = await getRoom("IJKL");
    expect(room?.vote?.votes).toEqual({ p1: "p3" });
  });

  it("rejects a vote for an unknown target", async () => {
    await createRoom(fixture("MNOP"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "MNOP", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "ghost" });

    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "cible de vote invalide" } });
  });

  it("rejects a vote outside the VOTE phase", async () => {
    const state = fixture("QRST");
    await createRoom({ ...state, phase: "DAY", vote: null });
    const io = fakeIo();
    const socket = fakeSocket();
    registerVoteEvents(io as never, socket as never, () => ({ roomCode: "QRST", playerId: "p1" }));

    await socket.trigger("SUBMIT_VOTE", { targetPlayerId: "p2" });

    expect(socket.emitted).toContainEqual({ event: "ROOM_ERROR", payload: { message: "aucun vote en cours" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- voteEvents`
Expected: FAIL — `Cannot find module './voteEvents.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/day/voteEvents.ts`:

```typescript
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import { transition } from "../state/phases.js";
import { resolveVotes, type VoteResult } from "../state/voteResolver.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const submitVoteSchema = z.object({ targetPlayerId: z.string().min(1) });

class NotInVoteError extends Error {}
class InvalidTargetError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotInVoteError) return "aucun vote en cours";
  if (err instanceof InvalidTargetError) return "cible de vote invalide";
  return "vote invalide";
}

export function registerVoteEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("SUBMIT_VOTE", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = submitVoteSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "vote invalide" });
        return;
      }
      let result: VoteResult | null = null;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          if (room.phase !== "VOTE" || !room.vote) throw new NotInVoteError();
          const voterExists = room.players.some((p) => p.id === membership.playerId);
          const targetExists = room.players.some((p) => p.id === parsed.data.targetPlayerId);
          if (!voterExists || !targetExists) throw new InvalidTargetError();

          const votes = { ...room.vote.votes, [membership.playerId]: parsed.data.targetPlayerId };
          if (Object.keys(votes).length < room.players.length) {
            return { ...room, vote: { votes }, updatedAt: Date.now() };
          }
          result = resolveVotes(
            votes,
            room.players.map((p) => p.id),
          );
          return { ...transition(room, "REVEAL"), vote: null, updatedAt: Date.now() };
        });
        if (result) {
          io.to(state.roomCode).emit("VOTE_RESULT", result);
        }
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- voteEvents`
Expected: PASS

- [ ] **Step 5: Wire it into `roomEvents.ts`**

Add the import:

```typescript
import { registerVoteEvents } from "../day/voteEvents.js";
```

At the bottom of `registerRoomEvents`:

```typescript
  registerRoleSelectEvents(io, socket, () => membership, tickRunner);
  registerNightActionEvents(io, socket, () => membership);
  registerDayDurationEvents(io, socket, () => membership);
  registerVoteEvents(io, socket, () => membership);
```

In the reconnect block, right after the `socket.emit("DAY_DURATION_UPDATE", ...)` line added in Task 4, add DAY/VOTE catch-up:

```typescript
        if (state.phase === "DAY" && state.day) {
          const elapsed = Date.now() - state.day.startedAt;
          const remainingMs = Math.max(state.day.durationMs - elapsed, 0);
          socket.emit("DAY_START", { durationMs: remainingMs });
        }
        if (state.phase === "VOTE") {
          socket.emit("VOTE_START", {});
        }
```

- [ ] **Step 6: Run the whole server suite**

Run: `npm run test -w server`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/day/voteEvents.ts server/src/day/voteEvents.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: resolve simultaneous votes and transition VOTE to REVEAL"
```

---

## Task 7: `useRoomSocket` — day/vote client state

**Files:**
- Modify: `client/src/hooks/useRoomSocket.ts`
- Modify: `client/src/hooks/useRoomSocket.test.ts`
- Modify: `client/src/pages/Home.test.tsx`
- Modify: `client/src/pages/Lobby.test.tsx`
- Modify: `client/src/pages/RoleSelect.test.tsx`
- Modify: `client/src/App.test.tsx`

**Interfaces:**
- Produces on `RoomSession`: `dayDurationMs: number`, `daySession: { durationMs: number } | null`, `voteStarted: boolean`, `voteResult: { tally: Record<string, number>; eliminated: string[] } | null`, `setDayDuration: (durationMs: number) => void`, `submitVote: (targetPlayerId: string) => void`.
- Consumed by Tasks 8–10 (`Day.tsx`, `Vote.tsx`, `Night.tsx`, `RoleSelect.tsx`).
- **Repo-specific note:** `client`'s `tsc -b` build type-checks test files (unlike `server`/`shared`). Every file above that builds a full `RoomSession`-shaped mock object literal must get the 6 new fields added, or `npm run build -w client` fails with "missing properties" — this is not optional cleanup, it's required for the build to pass.

- [ ] **Step 1: Write the failing test**

Add to `client/src/hooks/useRoomSocket.test.ts` (find the existing `describe` block structure and add a new one at the end, following the file's established pattern of grabbing the mock socket instance registered via the `socket.io-client` mock and calling its captured handlers — read the top of the file first to reuse its existing `getMockSocket()`/handler-capture helper rather than re-inventing one):

```typescript
describe("day/vote state", () => {
  it("DAY_START sets daySession and resets vote state; VOTE_START flips voteStarted; VOTE_RESULT sets voteResult", () => {
    const { result } = renderHook(() => useRoomSocket());
    const socket = getMockSocket();

    act(() => {
      socket.trigger("DAY_START", { durationMs: 180_000 });
    });
    expect(result.current.daySession).toEqual({ durationMs: 180_000 });
    expect(result.current.voteStarted).toBe(false);
    expect(result.current.voteResult).toBeNull();

    act(() => {
      socket.trigger("VOTE_START", {});
    });
    expect(result.current.voteStarted).toBe(true);

    act(() => {
      socket.trigger("VOTE_RESULT", { tally: { p1: 2 }, eliminated: ["p1"] });
    });
    expect(result.current.voteResult).toEqual({ tally: { p1: 2 }, eliminated: ["p1"] });
  });

  it("DAY_DURATION_UPDATE sets dayDurationMs; setDayDuration/submitVote emit the right events", () => {
    const { result } = renderHook(() => useRoomSocket());
    const socket = getMockSocket();

    act(() => {
      socket.trigger("DAY_DURATION_UPDATE", { durationMs: 300_000 });
    });
    expect(result.current.dayDurationMs).toBe(300_000);

    act(() => {
      result.current.setDayDuration(120_000);
    });
    expect(socket.emit).toHaveBeenCalledWith("SET_DAY_DURATION", { durationMs: 120_000 });

    act(() => {
      result.current.submitVote("p2");
    });
    expect(socket.emit).toHaveBeenCalledWith("SUBMIT_VOTE", { targetPlayerId: "p2" });
  });
});
```

If the existing test file doesn't already expose a `getMockSocket()`/`socket.trigger(...)` helper, inspect its top-of-file mock setup (it mocks `socket.io-client`'s `io()` to return a controllable fake) before writing this — reuse the exact same mock instance access pattern the file already uses for `TICK_START`/`NIGHT_END`, don't introduce a second mocking strategy.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useRoomSocket`
Expected: FAIL — `result.current.daySession` is undefined / `setDayDuration is not a function`

- [ ] **Step 3: Write minimal implementation**

In `client/src/hooks/useRoomSocket.ts`, extend the import list:

```typescript
import type {
  ClientToServerEvents,
  GameMode,
  NightTickId,
  PublicPlayer,
  RoleCounts,
  ServerToClientEvents,
} from "@onuw/shared";
import { DEFAULT_DAY_DURATION_MS } from "@onuw/shared";
```

Add a new interface next to `RoleSelectionState`:

```typescript
export interface DaySession {
  durationMs: number;
}

export interface VoteResultState {
  tally: Record<string, number>;
  eliminated: string[];
}
```

Extend `RoomSession`:

```typescript
export interface RoomSession {
  roomCode: string;
  playerId: string;
  players: PublicPlayer[];
  roleSelection: RoleSelectionState | null;
  error: string | null;
  createRoom: (pseudo: string) => void;
  joinRoom: (roomCode: string, pseudo: string) => void;
  startRoleSelect: () => void;
  setRoleMode: (mode: GameMode) => void;
  setCustomRoles: (roles: RoleCounts) => void;
  startGame: () => void;
  currentTick: CurrentTick | null;
  nightPaused: boolean;
  nightEnded: boolean;
  actionResult: { tickId: NightTickId; result: unknown } | null;
  submitNightAction: (tickId: NightTickId, params: Record<string, unknown>) => void;
  dayDurationMs: number;
  daySession: DaySession | null;
  voteStarted: boolean;
  voteResult: VoteResultState | null;
  setDayDuration: (durationMs: number) => void;
  submitVote: (targetPlayerId: string) => void;
}
```

Inside `useRoomSocket`, add the new state:

```typescript
  const [dayDurationMs, setDayDurationMs] = useState(DEFAULT_DAY_DURATION_MS);
  const [daySession, setDaySession] = useState<DaySession | null>(null);
  const [voteStarted, setVoteStarted] = useState(false);
  const [voteResult, setVoteResult] = useState<VoteResultState | null>(null);
```

Inside the connection `useEffect`, add the listeners right after `socket.on("ACTION_RESULT", ...)`:

```typescript
    socket.on("DAY_DURATION_UPDATE", (payload) => setDayDurationMs(payload.durationMs));
    socket.on("DAY_START", (payload) => {
      setDaySession({ durationMs: payload.durationMs });
      setVoteStarted(false);
      setVoteResult(null);
    });
    socket.on("VOTE_START", () => setVoteStarted(true));
    socket.on("VOTE_RESULT", (payload) => setVoteResult(payload));
```

Add the two new callbacks next to `submitNightAction`:

```typescript
  const setDayDuration = useCallback((durationMs: number) => {
    socketRef.current?.emit("SET_DAY_DURATION", { durationMs });
  }, []);

  const submitVote = useCallback((targetPlayerId: string) => {
    socketRef.current?.emit("SUBMIT_VOTE", { targetPlayerId });
  }, []);
```

Add the new fields/fns to the returned object:

```typescript
  return {
    roomCode,
    playerId,
    players,
    roleSelection,
    error,
    createRoom,
    joinRoom,
    startRoleSelect,
    setRoleMode,
    setCustomRoles,
    startGame,
    currentTick,
    nightPaused,
    nightEnded,
    actionResult,
    submitNightAction,
    dayDurationMs,
    daySession,
    voteStarted,
    voteResult,
    setDayDuration,
    submitVote,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useRoomSocket`
Expected: PASS

- [ ] **Step 5: Update every full `RoomSession` mock fixture so `npm run build -w client` still type-checks**

In `client/src/pages/Home.test.tsx`'s `baseSession()`, `client/src/pages/Lobby.test.tsx`'s `baseSession()`, and `client/src/pages/RoleSelect.test.tsx`'s `baseSession()`, add these 6 lines right after the existing `submitNightAction: vi.fn(),` line:

```typescript
    dayDurationMs: 240_000,
    daySession: null,
    voteStarted: false,
    voteResult: null,
    setDayDuration: vi.fn(),
    submitVote: vi.fn(),
```

In `client/src/App.test.tsx`, both inline `vi.mocked(useRoomSocket).mockReturnValue({ ... })` object literals get the same 6 lines added right after their `submitNightAction: vi.fn(),` line.

- [ ] **Step 6: Run the client build to confirm the fixtures type-check**

Run: `npm run build -w client`
Expected: PASS (no "missing properties" errors on any `RoomSession` mock)

- [ ] **Step 7: Run the full client test suite**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useRoomSocket.ts client/src/hooks/useRoomSocket.test.ts client/src/pages/Home.test.tsx client/src/pages/Lobby.test.tsx client/src/pages/RoleSelect.test.tsx client/src/App.test.tsx
git commit -m "feat: track day/vote socket state in useRoomSocket"
```

---

## Task 8: `Day.tsx` — countdown UI, and `Night.tsx` redirects into it

**Files:**
- Create: `client/src/pages/Day.tsx`
- Test: `client/src/pages/Day.test.tsx`
- Modify: `client/src/pages/Night.tsx`
- Modify: `client/src/pages/Night.test.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `useRoomSocket()`'s `daySession`, `voteStarted` (Task 7).
- Produces: `Day` default export, routed at `/room/:roomCode/day`. Navigates to `/room/:roomCode/vote` once `voteStarted` is true (Task 9 provides that route/page).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Day.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Day from "./Day";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    daySession: null,
    voteStarted: false,
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/day" element={<Day />} />
        <Route path="/room/:roomCode/vote" element={<div>vote-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Day", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useRoomSocket).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a waiting message before the day session arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCD/day");
    expect(screen.getByText(/en attente/i)).toBeInTheDocument();
  });

  it("shows the initial duration and counts down every second", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 125_000 } }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");
    expect(screen.getByText("2:05")).toBeInTheDocument();

    vi.advanceTimersByTime(5000);
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("navigates to the vote page once voteStarted is true", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ daySession: { durationMs: 60_000 }, voteStarted: true }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/day");
    expect(screen.getByText("vote-page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- Day.test`
Expected: FAIL — `Cannot find module './Day'`

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/Day.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Day() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { daySession, voteStarted } = useRoomSocket();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!daySession) return;
    setRemainingMs(daySession.durationMs);
    const interval = setInterval(() => {
      setRemainingMs((prev) => (prev !== null ? Math.max(prev - 1000, 0) : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [daySession]);

  useEffect(() => {
    if (voteStarted && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/vote`);
    }
  }, [voteStarted, routeRoomCode, navigate]);

  if (remainingMs === null) {
    return <p>En attente du début de la discussion…</p>;
  }

  return (
    <div>
      <h1>Discussion</h1>
      <p>{formatRemaining(remainingMs)}</p>
    </div>
  );
}

export default Day;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- Day.test`
Expected: PASS

- [ ] **Step 5: Wire `Night.tsx` to redirect into `/day`**

In `client/src/pages/Night.tsx`, add imports:

```typescript
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
```

Destructure `daySession` from `useRoomSocket()` and add the redirect effect:

```tsx
function Night() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, currentTick, nightPaused, nightEnded, actionResult, submitNightAction, daySession } =
    useRoomSocket();
  useFullscreen(!nightEnded);

  useEffect(() => {
    if (daySession && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/day`);
    }
  }, [daySession, routeRoomCode, navigate]);

  if (nightEnded) return <p>La nuit est terminée.</p>;
  ...
```

(the rest of the function body is unchanged)

- [ ] **Step 6: Update `Night.test.tsx` fixtures and add the redirect test**

Add `daySession: null` to each of the 4 existing `mockUseRoomSocket.mockReturnValue({...})` objects in `client/src/pages/Night.test.tsx`.

Since `Night` now calls `useParams`/`useNavigate`, the test helper must render it under a route with a `:roomCode` param and a `/day` stub target — update `renderNight()`:

```typescript
function renderNight() {
  return render(
    <MemoryRouter initialEntries={["/room/ABCD/night"]}>
      <Routes>
        <Route path="/room/:roomCode/night" element={<Night />} />
        <Route path="/room/:roomCode/day" element={<div>day-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
```

Add a new test at the end of the `describe("Night", ...)` block:

```typescript
  it("navigates to the day page once daySession is set", () => {
    mockUseRoomSocket.mockReturnValue({
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      currentTick: null,
      nightPaused: false,
      nightEnded: true,
      actionResult: null,
      submitNightAction: vi.fn(),
      daySession: { durationMs: 240_000 },
    });

    renderNight();
    expect(screen.getByText("day-page")).toBeInTheDocument();
  });
```

- [ ] **Step 7: Add the `/day` route to `App.tsx`**

```tsx
import Day from "./pages/Day";
```

```tsx
        <Route path="/room/:roomCode/day" element={<Day />} />
```

- [ ] **Step 8: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/Day.tsx client/src/pages/Day.test.tsx client/src/pages/Night.tsx client/src/pages/Night.test.tsx client/src/App.tsx
git commit -m "feat: add Day.tsx countdown and wire Night to redirect into it"
```

---

## Task 9: `Vote.tsx` — big pseudo buttons, simultaneous reveal

**Files:**
- Create: `client/src/pages/Vote.tsx`
- Test: `client/src/pages/Vote.test.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `useRoomSocket()`'s `playerId`, `players`, `voteResult`, `submitVote` (Task 7).
- Produces: `Vote` default export, routed at `/room/:roomCode/vote`.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Vote.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Vote from "./Vote";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
    voteResult: null,
    submitVote: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/vote" element={<Vote />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Vote", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReset();
  });

  it("shows a big button per player and submits a vote on tap", () => {
    const submitVote = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(baseSession({ submitVote }) as ReturnType<typeof useRoomSocket>);

    renderAt("/room/ABCD/vote");
    fireEvent.click(screen.getByRole("button", { name: "Bob" }));

    expect(submitVote).toHaveBeenCalledWith("p2");
    expect(screen.getByText(/enregistré/i)).toBeInTheDocument();
  });

  it("shows the tally and eliminated players once VOTE_RESULT arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        voteResult: { tally: { p1: 1, p2: 2, p3: 0 }, eliminated: ["p2"] },
      }) as ReturnType<typeof useRoomSocket>,
    );

    renderAt("/room/ABCD/vote");
    expect(screen.getByText(/Bob.*2 voix.*éliminé/is)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bob" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- Vote.test`
Expected: FAIL — `Cannot find module './Vote'`

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/Vote.tsx`:

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Vote() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const { players, voteResult, submitVote } = useRoomSocket();
  const [votedFor, setVotedFor] = useState<string | null>(null);

  if (voteResult) {
    return (
      <div>
        <h1>Résultat du vote — {routeRoomCode}</h1>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              {p.pseudo} — {voteResult.tally[p.id] ?? 0} voix
              {voteResult.eliminated.includes(p.id) ? " — éliminé" : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <h1>Vote — {routeRoomCode}</h1>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => {
                setVotedFor(p.id);
                submitVote(p.id);
              }}
              aria-pressed={votedFor === p.id}
            >
              {p.pseudo}
            </button>
          </li>
        ))}
      </ul>
      {votedFor && <p>Vote enregistré, en attente des autres joueurs…</p>}
    </div>
  );
}

export default Vote;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- Vote.test`
Expected: PASS

- [ ] **Step 5: Add the `/vote` route to `App.tsx`**

```tsx
import Vote from "./pages/Vote";
```

```tsx
        <Route path="/room/:roomCode/vote" element={<Vote />} />
```

- [ ] **Step 6: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Vote.tsx client/src/pages/Vote.test.tsx client/src/App.tsx
git commit -m "feat: add Vote.tsx with per-player buttons and simultaneous result reveal"
```

---

## Task 10: Host control for the day duration in `RoleSelect.tsx`

**Files:**
- Modify: `client/src/pages/RoleSelect.tsx`
- Modify: `client/src/pages/RoleSelect.test.tsx`

**Interfaces:**
- Consumes: `useRoomSocket()`'s `dayDurationMs`, `setDayDuration` (Task 7), `MIN_DAY_DURATION_MS`/`MAX_DAY_DURATION_MS` (Task 1).
- This is the "avant la partie" host control the spec calls for — placed on the same pre-game screen as the role-mode picker, not a separate page.

- [ ] **Step 1: Write the failing test**

Add to `client/src/pages/RoleSelect.test.tsx`, at the end of the `describe("RoleSelect", ...)` block (reuse the file's existing `baseSession()` helper, extended in Task 7 with the new fields):

```typescript
  it("lets the host change the day duration and shows it to everyone", () => {
    const setDayDuration = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ dayDurationMs: 240_000, setDayDuration }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");

    const input = screen.getByLabelText(/durée de la discussion/i) as HTMLInputElement;
    expect(input.value).toBe("4");

    fireEvent.change(input, { target: { value: "2" } });
    expect(setDayDuration).toHaveBeenCalledWith(120_000);
  });

  it("hides the day duration control from non-hosts but still shows the value", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        dayDurationMs: 300_000,
        players: [
          { id: "p1", pseudo: "Alice", isHost: true, connected: true },
          { id: "p2", pseudo: "Bob", isHost: false, connected: true },
        ],
        playerId: "p2",
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");

    expect(screen.queryByLabelText(/durée de la discussion/i)).not.toBeInTheDocument();
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- RoleSelect.test`
Expected: FAIL — no element with label "durée de la discussion"

- [ ] **Step 3: Write minimal implementation**

In `client/src/pages/RoleSelect.tsx`, extend the shared import:

```typescript
import { ROLE_IDS, totalRoleCount, MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "@onuw/shared";
```

Destructure the new fields from `useRoomSocket()`:

```typescript
  const { playerId, players, roleSelection, currentTick, setRoleMode, setCustomRoles, startGame, dayDurationMs, setDayDuration } =
    useRoomSocket();
```

Add a block right after the mode-picker `<div>` (before the `{mode === "custom" && ...}` block):

```tsx
      {isHost ? (
        <div>
          <label htmlFor="day-duration">Durée de la discussion (minutes)</label>
          <input
            id="day-duration"
            type="number"
            min={MIN_DAY_DURATION_MS / 60_000}
            max={MAX_DAY_DURATION_MS / 60_000}
            value={dayDurationMs / 60_000}
            onChange={(e) => setDayDuration(Number(e.target.value) * 60_000)}
          />
        </div>
      ) : (
        <p>Durée de la discussion : {dayDurationMs / 60_000} min</p>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- RoleSelect.test`
Expected: PASS

- [ ] **Step 5: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RoleSelect.tsx client/src/pages/RoleSelect.test.tsx
git commit -m "feat: let the host set the day discussion duration from RoleSelect"
```

---

## Final Verification

- [ ] Run the entire monorepo suite: `npm run test`
- [ ] Run the entire monorepo build: `npm run build`
- [ ] Run lint: `npm run lint`

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** timer visible + host-adjustable (Task 10), simultaneous vote reveal with big buttons (Task 9), server-authoritative Redis-backed timing for Day mirroring the Night tick runner (Task 2/3), phase transitions reusing the existing `phases.ts` state machine unmodified (Task 6). Win-condition computation and `Reveal.tsx` are explicitly out of scope (Phase 6).
- **Type-consistency check across tasks:** `DayState`/`VoteState`/`VoteResult` field names are identical everywhere they cross a task boundary (`day.durationMs`, `day.startedAt`, `vote.votes`, `VoteResult.tally`/`.eliminated`). `RoomSession.daySession`/`.voteStarted`/`.voteResult` names match what `Day.tsx`/`Vote.tsx`/`Night.tsx` destructure in Tasks 8–9.
- **Known limitation, deliberately deferred (not built here):** if a player disconnects during VOTE and never reconnects, `Object.keys(votes).length` never reaches `room.players.length` and the vote never resolves — there's no spec requirement for a vote timeout/skip-disconnected-players rule, so this plan doesn't invent one. Worth flagging to the user before Phase 6 in case they want it addressed (e.g. only counting connected players in the resolution threshold) — same "note deferred items rather than silently scope-creep" convention this project already uses in the master phase-plan document.
