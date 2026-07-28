# Phase 1 — State Machine Serveur & Moteur de Tick — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative, Redis-backed room store, phase transition guards, the generic night `TickRunner`, the 10-entry `NIGHT_ORDER` with pure `actionResolvers` per role (including the Doppelganger chaining/9a special case), Socket.io's Redis adapter wiring, and silent-reconnect + night-pause/grace-period handling — all testable without any UI, per `docs/superpowers/plans/2026-07-28-onuw-web-app.md` §Phase 1.

**Architecture:** `GameState` lives entirely in Redis (never in a process-local `Map`), read/written through `server/src/rooms/roomStore.ts`. The `TickRunner` computes tick timing (fixed duration + jitter) once, persists `tickStartedAt`/`durationMs`/`tickIndex` to Redis so any process can recompute remaining time, and drives transitions via injectable `broadcast`/`emitToPlayer`/`scheduleAdvance` callbacks — no direct Socket.io coupling, no per-role branching. Role logic lives in a `Record<RoleId, ActionResolver>` table of pure functions; the tick runner never knows what a resolver does. `@socket.io/redis-adapter` is attached in `createApp()` so broadcasts reach sockets on other instances (forward-compatible with Phase 7's Vercel deployment).

**Tech Stack:** Node.js, TypeScript strict (NodeNext resolution), `ioredis` (works against both local Redis and Upstash's Redis-protocol endpoint), `@socket.io/redis-adapter`, Vitest.

## Global Constraints

- Server code uses `NodeNext` module resolution: every relative import between `.ts` files MUST include the `.js` extension (e.g. `from "./roomStore.js"`), or `tsc -p server/tsconfig.json` fails. Verified against `server/src/index.ts` and `server/tsconfig.json:6-7`.
- All new server files import types from `@onuw/shared` using `import type { ... }` only (never a runtime import). This repo's `@onuw/shared` package resolves to `shared/dist/*` (built output) via the npm workspace symlink — `import type` is erased at compile time so server tests never need `shared/dist` to be rebuilt. If any future task needs a **runtime** value from `@onuw/shared` (e.g. `isValidRoleId`), run `npm run build -w shared` first and note it explicitly — do not assume it "just works."
- `GameState` is the single source of truth and lives only in Redis, keyed by room code (`server/src/rooms/roomStore.ts`). No in-memory `Map` of rooms anywhere.
- Every `NightTick` in `NIGHT_ORDER` always runs for every player, active role or not — no conditional skipping of ticks (anti-tell guarantee from the spec, `onuw-web-spec.md` §3).
- `actionResolvers` are pure functions: `(actingPlayerId, gameState, params) => { gameState, result }`. They never mutate their input `GameState`; they return a new object (spread-based immutable updates only, per this user's global coding-style.md).
- Tests that touch Redis require a local Redis reachable at `REDIS_URL` (default `redis://localhost:6379`), started via `docker-compose up -d` (added in Task 2). Tests use logical DB 15 (`redis://localhost:6379/15`) so `flushdb` in test cleanup never touches a dev DB.
- No `console.log` in source files (hooks flag it) — use thrown errors for unrecoverable states, nothing for expected control flow.

**Decisions locked in during this plan (filling gaps left open by the pre-implementation plan doc):**
- **Doppelganger "immediate chain" role set is `["minion", "seer", "robber", "troublemaker", "drunk"]`** — the master plan (`2026-07-28-onuw-web-app.md` point 5) only explicitly named Seer/Robber/Troublemaker/Drunk; it left Minion uncategorized. Per the official rulebook, copying the Minion also triggers an immediate view (no mutual-recognition requirement, unlike Werewolf/Mason), so it belongs in the same bucket. Werewolf/Mason copies become active **in that role's own later tick** (mutual recognition must be simultaneous); Villager/Tanner/Hunter copies do nothing further; Insomniac copy is deferred to the dedicated 10th tick (`doppelgangerInsomniac`).
- Ticks `seer`, `robber`, `troublemaker`, `drunk`, `minion`, `insomniac` exclude players whose `originalRoleId === "doppelganger"` from `activeFor` (they already acted via the chain, or will act in tick 9a) — only `werewolf` and `mason` include the Doppelganger generically.
- Room TTL: 4 hours of inactivity (`ROOM_TTL_SECONDS`), refreshed on every write.
- Night disconnect grace period: 40s (`NIGHT_DISCONNECT_GRACE_MS`), matching the master plan's default.
- `TickRunner` schedules tick advancement with real `setTimeout` by default (test-injectable via `scheduleAdvance`) — correct for the local/dev Node process used through Phase 1-6; the Vercel-safe "any instance can resume from Redis timestamps" property is already satisfied because all state (`tickIndex`, `tickStartedAt`, `durationMs`) is Redis-resident, so Phase 7 can swap the trigger mechanism without touching this module's core logic.

---

## Task 1: Extend shared types for room/night state

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`

**Interfaces:**
- Produces: `Player.connected: boolean`, `Player.originalRoleId?: RoleId`, `Player.currentRoleId?: RoleId`; `NightState` interface; `GameState.center: RoleId[]`, `GameState.night: NightState | null`, `GameState.createdAt: number`, `GameState.updatedAt: number`.

- [ ] **Step 1: Write the failing test**

Append to `shared/src/types.test.ts`:

```typescript
import type { GameState, NightState, Player } from "./types";

describe("GameState shape", () => {
  it("allows a full night-in-progress state", () => {
    const night: NightState = {
      tickIndex: 2,
      tickStartedAt: 1000,
      durationMs: 7000,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    };
    const player: Player = {
      id: "p1",
      pseudo: "Alice",
      isHost: true,
      connected: true,
      originalRoleId: "seer",
      currentRoleId: "seer",
    };
    const state: GameState = {
      roomCode: "ABCD",
      phase: "NIGHT",
      players: [player],
      center: ["villager", "villager", "tanner"],
      night,
      createdAt: 500,
      updatedAt: 1000,
    };

    expect(state.night?.tickIndex).toBe(2);
    expect(state.players[0].currentRoleId).toBe("seer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `Property 'connected' is missing`, `NightState` not exported, etc. (TypeScript compile error surfaced by Vitest's esbuild transform).

- [ ] **Step 3: Write minimal implementation**

Replace the `Player` and `GameState` sections of `shared/src/types.ts` (keep `ROLE_IDS`, `isValidRoleId`, `RoomPhase`, `ServerToClientEvents`, `ClientToServerEvents` unchanged) with:

```typescript
export interface Player {
  id: string;
  pseudo: string;
  isHost: boolean;
  connected: boolean;
  originalRoleId?: RoleId;
  currentRoleId?: RoleId;
}

export interface NightState {
  tickIndex: number;
  tickStartedAt: number;
  durationMs: number;
  paused: boolean;
  remainingMsAtPause: number | null;
  doppelgangerCopiedRoleId: RoleId | null;
  doppelgangerCopiedPlayerId: string | null;
}

export interface GameState {
  roomCode: string;
  phase: RoomPhase;
  players: Player[];
  center: RoleId[];
  night: NightState | null;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS (4 tests total: the 3 pre-existing `isValidRoleId` tests + the new one).

- [ ] **Step 5: Rebuild shared and confirm server's existing test still passes**

Run: `npm run build -w shared && npm run test -w server`
Expected: PASS — `server/src/index.test.ts` only uses `import type` from `@onuw/shared`, so this is a sanity check, not a hard dependency.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts
git commit -m "feat: extend GameState/Player with night-tick and role-swap fields"
```

---

## Task 2: Redis dev infra and client wrapper

**Files:**
- Create: `docker-compose.yml`
- Create: `server/src/redis/client.ts`
- Create: `server/src/redis/client.test.ts`
- Modify: `server/package.json` (add `ioredis` dependency)

**Interfaces:**
- Produces: `getRedisClient(): Redis`, `closeRedisClient(): Promise<void>` — both consumed by every later Redis-touching module.

- [ ] **Step 1: Add Redis to docker-compose**

Create `docker-compose.yml` at the repo root:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

Run: `docker-compose up -d` and leave it running for the rest of this plan.

- [ ] **Step 2: Add the ioredis dependency**

```bash
npm install ioredis --workspace=server
```

- [ ] **Step 3: Write the failing test**

Create `server/src/redis/client.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getRedisClient, closeRedisClient } from "./client.js";

describe("redis client", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("connects and round-trips a value", async () => {
    const redis = getRedisClient();
    await redis.set("smoke", "ok");
    const value = await redis.get("smoke");
    expect(value).toBe("ok");
  });

  it("returns the same instance on repeated calls", () => {
    expect(getRedisClient()).toBe(getRedisClient());
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './client.js'`.

- [ ] **Step 5: Write minimal implementation**

Create `server/src/redis/client.ts`:

```typescript
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = new Redis(url);
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS (2 tests). Requires the `docker-compose` Redis from Step 1 to be running.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml server/package.json package-lock.json server/src/redis/client.ts server/src/redis/client.test.ts
git commit -m "feat: add Redis dev infra and a shared ioredis client wrapper"
```

---

## Task 3: Room store (Redis-backed GameState CRUD + TTL)

**Files:**
- Create: `server/src/rooms/roomStore.ts`
- Create: `server/src/rooms/roomStore.test.ts`

**Interfaces:**
- Consumes: `getRedisClient()` from Task 2 (`server/src/redis/client.ts`).
- Produces: `createRoom(state: GameState): Promise<void>`, `getRoom(roomCode: string): Promise<GameState | null>`, `saveRoom(state: GameState): Promise<void>`, `deleteRoom(roomCode: string): Promise<void>`, `ROOM_TTL_SECONDS` constant — consumed by `phases.ts`, `tickRunner.ts`, `disconnectHandler.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/src/rooms/roomStore.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom, saveRoom, deleteRoom, ROOM_TTL_SECONDS } from "./roomStore.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "LOBBY",
    players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
    center: [],
    night: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("roomStore", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("round-trips a room through createRoom/getRoom", async () => {
    const state = fixture("ABCD");
    await createRoom(state);
    const loaded = await getRoom("ABCD");
    expect(loaded).toEqual(state);
  });

  it("returns null for an unknown room code", async () => {
    expect(await getRoom("ZZZZ")).toBeNull();
  });

  it("saveRoom overwrites and persists updates", async () => {
    const state = fixture("EFGH");
    await createRoom(state);
    await saveRoom({ ...state, phase: "ROLE_SELECT", updatedAt: 2 });
    const loaded = await getRoom("EFGH");
    expect(loaded?.phase).toBe("ROLE_SELECT");
  });

  it("deleteRoom removes the room", async () => {
    const state = fixture("IJKL");
    await createRoom(state);
    await deleteRoom("IJKL");
    expect(await getRoom("IJKL")).toBeNull();
  });

  it("sets a TTL on create", async () => {
    const state = fixture("MNOP");
    await createRoom(state);
    const ttl = await getRedisClient().ttl("room:MNOP");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './roomStore.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/rooms/roomStore.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS (5 new tests + previous 2 from Task 2 + 1 bootstrap test).

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roomStore.ts server/src/rooms/roomStore.test.ts
git commit -m "feat: add Redis-backed room store with TTL"
```

---

## Task 4: Phase transition state machine

**Files:**
- Create: `server/src/state/phases.ts`
- Create: `server/src/state/phases.test.ts`

**Interfaces:**
- Consumes: `GameState`, `RoomPhase` types from `@onuw/shared`.
- Produces: `canTransition(from: RoomPhase, to: RoomPhase): boolean`, `transition(state: GameState, to: RoomPhase): GameState` — consumed by `tickRunner.ts` (NIGHT→DAY) and later phases (2/3/5/6) for LOBBY→ROLE_SELECT, DAY→VOTE, VOTE→REVEAL, REVEAL→LOBBY.

- [ ] **Step 1: Write the failing test**

Create `server/src/state/phases.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { canTransition, transition } from "./phases.js";

const base: GameState = {
  roomCode: "ABCD",
  phase: "LOBBY",
  players: [],
  center: [],
  night: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("canTransition", () => {
  it.each([
    ["LOBBY", "ROLE_SELECT"],
    ["ROLE_SELECT", "NIGHT"],
    ["ROLE_SELECT", "LOBBY"],
    ["NIGHT", "DAY"],
    ["DAY", "VOTE"],
    ["VOTE", "REVEAL"],
    ["REVEAL", "LOBBY"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["LOBBY", "NIGHT"],
    ["NIGHT", "LOBBY"],
    ["DAY", "REVEAL"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("transition", () => {
  it("returns a new state with the updated phase and timestamp", () => {
    const next = transition({ ...base, phase: "LOBBY" }, "ROLE_SELECT");
    expect(next.phase).toBe("ROLE_SELECT");
    expect(next).not.toBe(base);
  });

  it("throws on an invalid transition", () => {
    expect(() => transition({ ...base, phase: "LOBBY" }, "NIGHT")).toThrow(
      /invalid phase transition/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './phases.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/state/phases.ts`:

```typescript
import type { GameState, RoomPhase } from "@onuw/shared";

const ALLOWED_TRANSITIONS: Record<RoomPhase, RoomPhase[]> = {
  LOBBY: ["ROLE_SELECT"],
  ROLE_SELECT: ["NIGHT", "LOBBY"],
  NIGHT: ["DAY"],
  DAY: ["VOTE"],
  VOTE: ["REVEAL"],
  REVEAL: ["LOBBY"],
};

export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transition(state: GameState, to: RoomPhase): GameState {
  if (!canTransition(state.phase, to)) {
    throw new Error(`invalid phase transition: ${state.phase} -> ${to}`);
  }
  return { ...state, phase: to, updatedAt: Date.now() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/state/phases.ts server/src/state/phases.test.ts
git commit -m "feat: add phase transition guards"
```

---

## Task 5: Night order config with activeFor logic

**Files:**
- Create: `server/src/night/nightOrder.ts`
- Create: `server/src/night/nightOrder.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Player`, `RoleId` types from `@onuw/shared`.
- Produces: `NightTickId` type, `NightTick` interface (`{ tickId, baseDurationMs, activeFor }`), `NIGHT_ORDER: NightTick[]` (10 entries) — consumed by `tickRunner.ts` (drives the loop) and `actionResolvers.ts` (shares `NightTickId` for the resolver table keys).

- [ ] **Step 1: Write the failing test**

Create `server/src/night/nightOrder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { GameState, Player } from "@onuw/shared";
import { NIGHT_ORDER } from "./nightOrder.js";

function player(overrides: Partial<Player>): Player {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, ...overrides };
}

function stateWith(players: Player[]): GameState {
  return {
    roomCode: "ABCD",
    phase: "NIGHT",
    players,
    center: [],
    night: {
      tickIndex: 0,
      tickStartedAt: 0,
      durationMs: 0,
      paused: false,
      remainingMsAtPause: null,
      doppelgangerCopiedRoleId: null,
      doppelgangerCopiedPlayerId: null,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("NIGHT_ORDER", () => {
  it("has exactly 10 ticks in the official + 9a order", () => {
    expect(NIGHT_ORDER.map((t) => t.tickId)).toEqual([
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
    ]);
  });

  it("werewolf tick includes a doppelganger who copied werewolf", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "werewolf")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "werewolf" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(true);
  });

  it("robber tick excludes a doppelganger who already copied robber", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "robber")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "robber" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(false);
  });

  it("robber tick includes a genuine robber", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "robber")!;
    const p = player({ originalRoleId: "robber", currentRoleId: "robber" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(true);
  });

  it("insomniac tick excludes a doppelganger who copied insomniac", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "insomniac")!;
    const p = player({ originalRoleId: "doppelganger", currentRoleId: "insomniac" });
    expect(tick.activeFor(p, stateWith([p]))).toBe(false);
  });

  it("doppelgangerInsomniac tick includes only a doppelganger who copied insomniac", () => {
    const tick = NIGHT_ORDER.find((t) => t.tickId === "doppelgangerInsomniac")!;
    const dopp = player({ id: "d1", originalRoleId: "doppelganger", currentRoleId: "insomniac" });
    const genuine = player({ id: "i1", originalRoleId: "insomniac", currentRoleId: "insomniac" });
    const state: GameState = {
      ...stateWith([dopp, genuine]),
      night: {
        ...stateWith([]).night!,
        doppelgangerCopiedRoleId: "insomniac",
        doppelgangerCopiedPlayerId: "d1",
      },
    };
    expect(tick.activeFor(dopp, state)).toBe(true);
    expect(tick.activeFor(genuine, state)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './nightOrder.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/night/nightOrder.ts`:

```typescript
import type { GameState, Player, RoleId } from "@onuw/shared";

export type NightTickId =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "doppelgangerInsomniac";

export interface NightTick {
  tickId: NightTickId;
  baseDurationMs: number;
  activeFor: (player: Player, gameState: GameState) => boolean;
}

function excludeDoppelganger(roleId: RoleId) {
  return (player: Player): boolean =>
    player.currentRoleId === roleId && player.originalRoleId !== "doppelganger";
}

function includeGenerically(roleId: RoleId) {
  return (player: Player): boolean => player.currentRoleId === roleId;
}

export const NIGHT_ORDER: NightTick[] = [
  { tickId: "doppelganger", baseDurationMs: 8000, activeFor: includeGenerically("doppelganger") },
  { tickId: "werewolf", baseDurationMs: 7000, activeFor: includeGenerically("werewolf") },
  { tickId: "minion", baseDurationMs: 5000, activeFor: excludeDoppelganger("minion") },
  { tickId: "mason", baseDurationMs: 5000, activeFor: includeGenerically("mason") },
  { tickId: "seer", baseDurationMs: 8000, activeFor: excludeDoppelganger("seer") },
  { tickId: "robber", baseDurationMs: 8000, activeFor: excludeDoppelganger("robber") },
  { tickId: "troublemaker", baseDurationMs: 7000, activeFor: excludeDoppelganger("troublemaker") },
  { tickId: "drunk", baseDurationMs: 5000, activeFor: excludeDoppelganger("drunk") },
  { tickId: "insomniac", baseDurationMs: 5000, activeFor: excludeDoppelganger("insomniac") },
  {
    tickId: "doppelgangerInsomniac",
    baseDurationMs: 5000,
    activeFor: (player, gameState) =>
      player.originalRoleId === "doppelganger" &&
      gameState.night?.doppelgangerCopiedRoleId === "insomniac",
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/night/nightOrder.ts server/src/night/nightOrder.test.ts
git commit -m "feat: add generic NIGHT_ORDER config with activeFor rules"
```

---

## Task 6: View-only action resolvers (werewolf, minion, mason, seer, insomniac)

**Files:**
- Create: `server/src/roles/actionResolvers.ts`
- Create: `server/src/roles/actionResolvers.test.ts`
- Create: `server/src/roles/helpers.ts`

**Interfaces:**
- Consumes: `GameState`, `Player`, `RoleId` from `@onuw/shared`.
- Produces: `getPlayer(gameState, playerId): Player`, `replacePlayer(gameState, playerId, patch): GameState` (in `helpers.ts`); `ActionResult<TResult>`, `ActionResolver<TParams, TResult>` types and `werewolfResolver`, `minionResolver`, `masonResolver`, `seerResolver`, `insomniacResolver` (in `actionResolvers.ts`) — Task 7/8 add more entries to the same file and to the exported `actionResolvers` record.

- [ ] **Step 1: Write the failing test**

Create `server/src/roles/actionResolvers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { GameState, Player } from "@onuw/shared";
import {
  werewolfResolver,
  minionResolver,
  masonResolver,
  seerResolver,
  insomniacResolver,
} from "./actionResolvers.js";

function player(overrides: Partial<Player>): Player {
  return { id: overrides.id ?? "p1", pseudo: "x", isHost: false, connected: true, ...overrides };
}

function stateWith(players: Player[], center: GameState["center"] = []): GameState {
  return { roomCode: "ABCD", phase: "NIGHT", players, center, night: null, createdAt: 0, updatedAt: 0 };
}

describe("werewolfResolver", () => {
  it("returns teammate ids for a two-wolf game", () => {
    const wolf1 = player({ id: "w1", currentRoleId: "werewolf" });
    const wolf2 = player({ id: "w2", currentRoleId: "werewolf" });
    const state = stateWith([wolf1, wolf2]);
    const { result } = werewolfResolver("w1", state, {});
    expect(result).toEqual({ teammateIds: ["w2"] });
  });

  it("returns a center card for a lone wolf", () => {
    const wolf = player({ id: "w1", currentRoleId: "werewolf" });
    const state = stateWith([wolf], ["seer", "villager", "tanner"]);
    const { result } = werewolfResolver("w1", state, { centerIndex: 0 });
    expect(result).toEqual({ centerRoleId: "seer" });
  });
});

describe("minionResolver", () => {
  it("returns the ids of all current werewolves", () => {
    const minion = player({ id: "m1", currentRoleId: "minion" });
    const wolf = player({ id: "w1", currentRoleId: "werewolf" });
    const { result } = minionResolver("m1", stateWith([minion, wolf]), {});
    expect(result).toEqual({ werewolfIds: ["w1"] });
  });
});

describe("masonResolver", () => {
  it("returns the ids of the other masons", () => {
    const mason1 = player({ id: "m1", currentRoleId: "mason" });
    const mason2 = player({ id: "m2", currentRoleId: "mason" });
    const { result } = masonResolver("m1", stateWith([mason1, mason2]), {});
    expect(result).toEqual({ masonIds: ["m2"] });
  });
});

describe("seerResolver", () => {
  it("views a player's current role", () => {
    const seer = player({ id: "s1", currentRoleId: "seer" });
    const target = player({ id: "t1", currentRoleId: "villager" });
    const { result } = seerResolver("s1", stateWith([seer, target]), {
      mode: "player",
      targetPlayerId: "t1",
    });
    expect(result).toEqual({ roleId: "villager" });
  });

  it("views two center cards", () => {
    const seer = player({ id: "s1", currentRoleId: "seer" });
    const state = stateWith([seer], ["tanner", "hunter", "villager"]);
    const { result } = seerResolver("s1", state, { mode: "center", centerIndices: [0, 1] });
    expect(result).toEqual({ roleIds: ["tanner", "hunter"] });
  });
});

describe("insomniacResolver", () => {
  it("views the acting player's own current role", () => {
    const insomniac = player({ id: "i1", currentRoleId: "robber" });
    const { result } = insomniacResolver("i1", stateWith([insomniac]), {});
    expect(result).toEqual({ roleId: "robber" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './actionResolvers.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/roles/helpers.ts`:

```typescript
import type { GameState, Player } from "@onuw/shared";

export function getPlayer(gameState: GameState, playerId: string): Player {
  const found = gameState.players.find((p) => p.id === playerId);
  if (!found) throw new Error(`player ${playerId} not found in room ${gameState.roomCode}`);
  return found;
}

export function replacePlayer(
  gameState: GameState,
  playerId: string,
  patch: Partial<Player>,
): GameState {
  return {
    ...gameState,
    players: gameState.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)),
  };
}

export function swapCurrentRoles(gameState: GameState, playerAId: string, playerBId: string): GameState {
  const a = getPlayer(gameState, playerAId);
  const b = getPlayer(gameState, playerBId);
  return {
    ...gameState,
    players: gameState.players.map((p) => {
      if (p.id === playerAId) return { ...p, currentRoleId: b.currentRoleId };
      if (p.id === playerBId) return { ...p, currentRoleId: a.currentRoleId };
      return p;
    }),
  };
}
```

Create `server/src/roles/actionResolvers.ts`:

```typescript
import type { GameState, RoleId } from "@onuw/shared";
import { getPlayer } from "./helpers.js";

export interface ActionResult<TResult = Record<string, never>> {
  gameState: GameState;
  result: TResult;
}

export type ActionResolver<TParams = Record<string, unknown>, TResult = unknown> = (
  actingPlayerId: string,
  gameState: GameState,
  params: TParams,
) => ActionResult<TResult>;

export const werewolfResolver: ActionResolver<
  { centerIndex?: number },
  { teammateIds: string[] } | { centerRoleId: RoleId }
> = (actingPlayerId, gameState, params) => {
  const teammateIds = gameState.players
    .filter((p) => p.currentRoleId === "werewolf" && p.id !== actingPlayerId)
    .map((p) => p.id);

  if (teammateIds.length === 0 && params.centerIndex !== undefined) {
    return { gameState, result: { centerRoleId: gameState.center[params.centerIndex] } };
  }
  return { gameState, result: { teammateIds } };
};

export const minionResolver: ActionResolver<Record<string, never>, { werewolfIds: string[] }> = (
  _actingPlayerId,
  gameState,
) => {
  const werewolfIds = gameState.players.filter((p) => p.currentRoleId === "werewolf").map((p) => p.id);
  return { gameState, result: { werewolfIds } };
};

export const masonResolver: ActionResolver<Record<string, never>, { masonIds: string[] }> = (
  actingPlayerId,
  gameState,
) => {
  const masonIds = gameState.players
    .filter((p) => p.currentRoleId === "mason" && p.id !== actingPlayerId)
    .map((p) => p.id);
  return { gameState, result: { masonIds } };
};

export type SeerParams =
  | { mode: "player"; targetPlayerId: string }
  | { mode: "center"; centerIndices: [number, number] };

export const seerResolver: ActionResolver<
  SeerParams,
  { roleId: RoleId } | { roleIds: [RoleId, RoleId] }
> = (_actingPlayerId, gameState, params) => {
  if (params.mode === "player") {
    const target = getPlayer(gameState, params.targetPlayerId);
    return { gameState, result: { roleId: target.currentRoleId! } };
  }
  const [a, b] = params.centerIndices;
  return { gameState, result: { roleIds: [gameState.center[a], gameState.center[b]] } };
};

export const insomniacResolver: ActionResolver<Record<string, never>, { roleId: RoleId }> = (
  actingPlayerId,
  gameState,
) => {
  const player = getPlayer(gameState, actingPlayerId);
  return { gameState, result: { roleId: player.currentRoleId! } };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/helpers.ts server/src/roles/actionResolvers.ts server/src/roles/actionResolvers.test.ts
git commit -m "feat: add view-only night action resolvers"
```

---

## Task 7: Mutating action resolvers (robber, troublemaker, drunk)

**Files:**
- Modify: `server/src/roles/actionResolvers.ts`
- Modify: `server/src/roles/actionResolvers.test.ts`

**Interfaces:**
- Consumes: `swapCurrentRoles` from `server/src/roles/helpers.ts` (Task 6).
- Produces: `robberResolver`, `troublemakerResolver`, `drunkResolver` added to the same file.

- [ ] **Step 1: Write the failing test**

Append to `server/src/roles/actionResolvers.test.ts`:

```typescript
import { robberResolver, troublemakerResolver, drunkResolver } from "./actionResolvers.js";

describe("robberResolver", () => {
  it("swaps roles with the target and reveals the new role", () => {
    const robber = player({ id: "r1", currentRoleId: "robber" });
    const target = player({ id: "t1", currentRoleId: "villager" });
    const { gameState, result } = robberResolver("r1", stateWith([robber, target]), {
      targetPlayerId: "t1",
    });
    expect(gameState.players.find((p) => p.id === "r1")?.currentRoleId).toBe("villager");
    expect(gameState.players.find((p) => p.id === "t1")?.currentRoleId).toBe("robber");
    expect(result).toEqual({ newRoleId: "villager" });
  });
});

describe("troublemakerResolver", () => {
  it("swaps two other players' roles without revealing anything", () => {
    const troublemaker = player({ id: "tm1", currentRoleId: "troublemaker" });
    const a = player({ id: "a1", currentRoleId: "villager" });
    const b = player({ id: "b1", currentRoleId: "seer" });
    const { gameState, result } = troublemakerResolver("tm1", stateWith([troublemaker, a, b]), {
      targetAId: "a1",
      targetBId: "b1",
    });
    expect(gameState.players.find((p) => p.id === "a1")?.currentRoleId).toBe("seer");
    expect(gameState.players.find((p) => p.id === "b1")?.currentRoleId).toBe("villager");
    expect(result).toEqual({});
  });
});

describe("drunkResolver", () => {
  it("swaps the drunk's role with a center card without revealing it", () => {
    const drunk = player({ id: "d1", currentRoleId: "drunk" });
    const state = stateWith([drunk], ["hunter", "villager", "tanner"]);
    const { gameState, result } = drunkResolver("d1", state, { centerIndex: 1 });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("villager");
    expect(gameState.center[1]).toBe("drunk");
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `robberResolver` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `server/src/roles/actionResolvers.ts` (add the import and the three resolvers):

```typescript
import { getPlayer, swapCurrentRoles } from "./helpers.js";
```

(replace the existing `import { getPlayer } from "./helpers.js";` line with the one above, then add:)

```typescript
export const robberResolver: ActionResolver<{ targetPlayerId: string }, { newRoleId: RoleId }> = (
  actingPlayerId,
  gameState,
  params,
) => {
  const swapped = swapCurrentRoles(gameState, actingPlayerId, params.targetPlayerId);
  const newRoleId = getPlayer(swapped, actingPlayerId).currentRoleId!;
  return { gameState: swapped, result: { newRoleId } };
};

export const troublemakerResolver: ActionResolver<{ targetAId: string; targetBId: string }> = (
  _actingPlayerId,
  gameState,
  params,
) => {
  const swapped = swapCurrentRoles(gameState, params.targetAId, params.targetBId);
  return { gameState: swapped, result: {} };
};

export const drunkResolver: ActionResolver<{ centerIndex: number }> = (
  actingPlayerId,
  gameState,
  params,
) => {
  const drunkPlayer = getPlayer(gameState, actingPlayerId);
  const centerRole = gameState.center[params.centerIndex];
  const nextCenter = gameState.center.map((role, i) =>
    i === params.centerIndex ? drunkPlayer.currentRoleId! : role,
  );
  const nextPlayers = gameState.players.map((p) =>
    p.id === actingPlayerId ? { ...p, currentRoleId: centerRole } : p,
  );
  return { gameState: { ...gameState, center: nextCenter, players: nextPlayers }, result: {} };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/actionResolvers.ts server/src/roles/actionResolvers.test.ts
git commit -m "feat: add mutating night action resolvers (robber, troublemaker, drunk)"
```

---

## Task 8: Doppelganger + doppelgangerInsomniac resolvers, and the resolver table

**Files:**
- Modify: `server/src/roles/actionResolvers.ts`
- Modify: `server/src/roles/actionResolvers.test.ts`

**Interfaces:**
- Consumes: all resolvers from Tasks 6/7.
- Produces: `doppelgangerResolver`, `doppelgangerInsomniacResolver`, and the exported `actionResolvers: Record<NightTickId, ActionResolver>` table — consumed by `tickRunner.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

Append to `server/src/roles/actionResolvers.test.ts`:

```typescript
import { doppelgangerResolver, doppelgangerInsomniacResolver, actionResolvers } from "./actionResolvers.js";

describe("doppelgangerResolver", () => {
  it("copies a passive role (villager) and does nothing else", () => {
    const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
    const villager = player({ id: "v1", originalRoleId: "villager", currentRoleId: "villager" });
    const state = stateWith([dopp, villager]);
    const { gameState, result } = doppelgangerResolver("d1", state, { targetPlayerId: "v1" });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("villager");
    expect(result).toEqual({ copiedRoleId: "villager" });
  });

  it("copies werewolf and becomes active in the werewolf tick generically (no chained action)", () => {
    const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
    const wolf = player({ id: "w1", originalRoleId: "werewolf", currentRoleId: "werewolf" });
    const state = stateWith([dopp, wolf]);
    const { gameState, result } = doppelgangerResolver("d1", state, { targetPlayerId: "w1" });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("werewolf");
    expect(result).toEqual({ copiedRoleId: "werewolf" });
  });

  it("copies robber and immediately chains the robber action", () => {
    const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
    const robber = player({ id: "r1", originalRoleId: "robber", currentRoleId: "robber" });
    const villager = player({ id: "v1", originalRoleId: "villager", currentRoleId: "villager" });
    const state = stateWith([dopp, robber, villager]);
    const { gameState, result } = doppelgangerResolver("d1", state, {
      targetPlayerId: "r1",
      subParams: { targetPlayerId: "v1" },
    });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("villager");
    expect(gameState.players.find((p) => p.id === "v1")?.currentRoleId).toBe("doppelganger");
    expect(result).toEqual({ copiedRoleId: "robber", chained: { newRoleId: "villager" } });
  });

  it("copies insomniac and defers, recording doppelgangerCopiedRoleId", () => {
    const dopp = player({ id: "d1", currentRoleId: "doppelganger" });
    const insomniac = player({ id: "i1", originalRoleId: "insomniac", currentRoleId: "insomniac" });
    const state = stateWith([dopp, insomniac]);
    const { gameState, result } = doppelgangerResolver("d1", state, { targetPlayerId: "i1" });
    expect(gameState.players.find((p) => p.id === "d1")?.currentRoleId).toBe("insomniac");
    expect(result).toEqual({ copiedRoleId: "insomniac" });
  });
});

describe("doppelgangerInsomniacResolver", () => {
  it("views the doppelganger's own (copied) current role", () => {
    const dopp = player({ id: "d1", originalRoleId: "doppelganger", currentRoleId: "insomniac" });
    const { result } = doppelgangerInsomniacResolver("d1", stateWith([dopp]), {});
    expect(result).toEqual({ roleId: "insomniac" });
  });
});

describe("actionResolvers table", () => {
  it("has an entry for every NightTickId", () => {
    const expectedKeys = [
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
    ];
    expect(Object.keys(actionResolvers).sort()).toEqual(expectedKeys.sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `doppelgangerResolver` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `server/src/roles/actionResolvers.ts`:

```typescript
import { replacePlayer } from "./helpers.js";
```

(fold this into the existing `import { getPlayer, swapCurrentRoles } from "./helpers.js";` line so it reads `import { getPlayer, replacePlayer, swapCurrentRoles } from "./helpers.js";`, then add:)

```typescript
const IMMEDIATE_CHAIN_ROLES: RoleId[] = ["minion", "seer", "robber", "troublemaker", "drunk"];

export const doppelgangerResolver: ActionResolver<
  { targetPlayerId: string; subParams?: Record<string, unknown> },
  { copiedRoleId: RoleId; chained?: unknown }
> = (actingPlayerId, gameState, params) => {
  const target = getPlayer(gameState, params.targetPlayerId);
  const copiedRoleId = target.originalRoleId;
  if (!copiedRoleId) throw new Error(`doppelganger target ${params.targetPlayerId} has no assigned role`);

  let nextState = replacePlayer(gameState, actingPlayerId, { currentRoleId: copiedRoleId });
  nextState = {
    ...nextState,
    night: nextState.night && {
      ...nextState.night,
      doppelgangerCopiedRoleId: copiedRoleId,
      doppelgangerCopiedPlayerId: actingPlayerId,
    },
  };

  if (IMMEDIATE_CHAIN_ROLES.includes(copiedRoleId)) {
    const chainResolver = actionResolvers[copiedRoleId as keyof typeof actionResolvers];
    const chainResult = chainResolver(actingPlayerId, nextState, params.subParams ?? {});
    return { gameState: chainResult.gameState, result: { copiedRoleId, chained: chainResult.result } };
  }

  return { gameState: nextState, result: { copiedRoleId } };
};

export const doppelgangerInsomniacResolver: ActionResolver<Record<string, never>, { roleId: RoleId }> = (
  actingPlayerId,
  gameState,
) => {
  const player = getPlayer(gameState, actingPlayerId);
  return { gameState, result: { roleId: player.currentRoleId! } };
};

export const actionResolvers = {
  doppelganger: doppelgangerResolver,
  werewolf: werewolfResolver,
  minion: minionResolver,
  mason: masonResolver,
  seer: seerResolver,
  robber: robberResolver,
  troublemaker: troublemakerResolver,
  drunk: drunkResolver,
  insomniac: insomniacResolver,
  doppelgangerInsomniac: doppelgangerInsomniacResolver,
} satisfies Record<string, ActionResolver<never, unknown>>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS. This type-checks under `strict`/`strictFunctionTypes` even though each resolver has a different concrete `TParams`: function parameters are checked contravariantly, and `never` (the table's declared `TParams`) is a subtype of every concrete params type, so every resolver's parameter type is a valid (trivially satisfied) contravariant match; each resolver's `TResult` is likewise covariant with `unknown`.

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/actionResolvers.ts server/src/roles/actionResolvers.test.ts
git commit -m "feat: add doppelganger chaining resolver and the full actionResolvers table"
```

---

## Task 9: Generic TickRunner

**Files:**
- Create: `server/src/night/tickRunner.ts`
- Create: `server/src/night/tickRunner.test.ts`

**Interfaces:**
- Consumes: `getRoom`/`saveRoom` from `server/src/rooms/roomStore.ts` (Task 3), `NightTick`/`NIGHT_ORDER` from `server/src/night/nightOrder.ts` (Task 5).
- Produces: `createTickRunner(deps: TickRunnerDeps): { startNight, advanceTick, pauseTick, resumeTick, scheduleTick }` — `pauseTick`/`resumeTick` are consumed by `disconnectHandler.ts` (Task 11); `startNight` will be wired to the `ROLE_SELECT -> NIGHT` transition in Phase 3.

- [ ] **Step 1: Write the failing test**

Create `server/src/night/tickRunner.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { createTickRunner } from "./tickRunner.js";
import type { NightTick } from "./nightOrder.js";

const TEST_ORDER: NightTick[] = [
  { tickId: "doppelganger" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "doppelganger" },
  { tickId: "werewolf" as const, baseDurationMs: 100, activeFor: (p) => p.currentRoleId === "werewolf" },
];

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, currentRoleId: "doppelganger" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, currentRoleId: "werewolf" },
    ],
    center: [],
    night: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("tickRunner", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("startNight sets phase to NIGHT, tickIndex 0, and broadcasts TICK_START with per-player payloads", async () => {
    await createRoom(fixture("ABCD"));
    const broadcast = vi.fn();
    const emitToPlayer = vi.fn();
    const scheduleAdvance = vi.fn();
    const runner = createTickRunner({ broadcast, emitToPlayer, scheduleAdvance, nightOrder: TEST_ORDER, jitterMs: 0 });

    await runner.startNight("ABCD");

    const room = await getRoom("ABCD");
    expect(room?.phase).toBe("NIGHT");
    expect(room?.night?.tickIndex).toBe(0);
    expect(broadcast).toHaveBeenCalledWith("ABCD", "TICK_START", { tickIndex: 0, tickId: "doppelganger", durationMs: 100 });
    expect(emitToPlayer).toHaveBeenCalledWith("p1", "TICK_PAYLOAD", { tickId: "doppelganger", active: true });
    expect(emitToPlayer).toHaveBeenCalledWith("p2", "TICK_PAYLOAD", { tickId: "doppelganger", active: false });
    expect(scheduleAdvance).toHaveBeenCalledWith("ABCD", 100);
  });

  it("advanceTick moves to the next tick", async () => {
    await createRoom(fixture("EFGH"));
    const broadcast = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("EFGH");
    await runner.advanceTick("EFGH");

    const room = await getRoom("EFGH");
    expect(room?.night?.tickIndex).toBe(1);
    expect(broadcast).toHaveBeenCalledWith("EFGH", "TICK_START", { tickIndex: 1, tickId: "werewolf", durationMs: 100 });
  });

  it("advanceTick past the last tick ends the night and moves to DAY", async () => {
    await createRoom(fixture("IJKL"));
    const broadcast = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance: vi.fn(),
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("IJKL");
    await runner.advanceTick("IJKL");
    await runner.advanceTick("IJKL");

    const room = await getRoom("IJKL");
    expect(room?.phase).toBe("DAY");
    expect(room?.night).toBeNull();
    expect(broadcast).toHaveBeenCalledWith("IJKL", "NIGHT_END", {});
  });

  it("pauseTick freezes remaining time and resumeTick reschedules with it", async () => {
    await createRoom(fixture("MNOP"));
    const broadcast = vi.fn();
    const scheduleAdvance = vi.fn();
    const runner = createTickRunner({
      broadcast,
      emitToPlayer: vi.fn(),
      scheduleAdvance,
      nightOrder: TEST_ORDER,
      jitterMs: 0,
    });

    await runner.startNight("MNOP");
    await runner.pauseTick("MNOP");

    let room = await getRoom("MNOP");
    expect(room?.night?.paused).toBe(true);
    expect(room?.night?.remainingMsAtPause).toBeLessThanOrEqual(100);
    expect(broadcast).toHaveBeenCalledWith("MNOP", "TICK_PAUSED", {});

    await runner.resumeTick("MNOP");
    room = await getRoom("MNOP");
    expect(room?.night?.paused).toBe(false);
    expect(broadcast).toHaveBeenCalledWith("MNOP", "TICK_RESUMED", { remainingMs: expect.any(Number) });
    expect(scheduleAdvance).toHaveBeenLastCalledWith("MNOP", expect.any(Number));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './tickRunner.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/night/tickRunner.ts`:

```typescript
import type { GameState } from "@onuw/shared";
import { getRoom, saveRoom } from "../rooms/roomStore.js";
import { NIGHT_ORDER, type NightTick } from "./nightOrder.js";

export interface TickRunnerDeps {
  broadcast: (roomCode: string, event: string, payload: unknown) => void;
  emitToPlayer: (playerId: string, event: string, payload: unknown) => void;
  nightOrder?: NightTick[];
  jitterMs?: number;
  scheduleAdvance?: (roomCode: string, delayMs: number) => void;
}

function computeDuration(tick: NightTick, jitterMs: number): number {
  return tick.baseDurationMs + Math.floor(Math.random() * jitterMs);
}

export function createTickRunner(deps: TickRunnerDeps) {
  const nightOrder = deps.nightOrder ?? NIGHT_ORDER;
  const jitterMs = deps.jitterMs ?? 1500;
  const scheduleAdvance =
    deps.scheduleAdvance ??
    ((roomCode: string, delayMs: number) => {
      setTimeout(() => {
        void advanceTick(roomCode);
      }, delayMs);
    });

  async function scheduleTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night) return;
    const tick = nightOrder[room.night.tickIndex];
    const durationMs = computeDuration(tick, jitterMs);
    const updated: GameState = {
      ...room,
      night: { ...room.night, durationMs, tickStartedAt: Date.now(), paused: false, remainingMsAtPause: null },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);

    deps.broadcast(roomCode, "TICK_START", { tickIndex: updated.night!.tickIndex, tickId: tick.tickId, durationMs });
    for (const p of updated.players) {
      deps.emitToPlayer(p.id, "TICK_PAYLOAD", { tickId: tick.tickId, active: tick.activeFor(p, updated) });
    }

    scheduleAdvance(roomCode, durationMs);
  }

  async function startNight(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room) throw new Error(`room ${roomCode} not found`);
    const updated: GameState = {
      ...room,
      phase: "NIGHT",
      night: {
        tickIndex: 0,
        tickStartedAt: Date.now(),
        durationMs: 0,
        paused: false,
        remainingMsAtPause: null,
        doppelgangerCopiedRoleId: null,
        doppelgangerCopiedPlayerId: null,
      },
      updatedAt: Date.now(),
    };
    await saveRoom(updated);
    await scheduleTick(roomCode);
  }

  async function advanceTick(roomCode: string): Promise<void> {
    const room = await getRoom(roomCode);
    if (!room || !room.night || room.night.paused) return;
    const nextIndex = room.night.tickIndex + 1;

    if (nextIndex >= nightOrder.length) {
      const updated: GameState = { ...room, phase: "DAY", night: null, updatedAt: Date.now() };
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
    scheduleAdvance(roomCode, remainingMs);
  }

  return { startNight, advanceTick, pauseTick, resumeTick, scheduleTick };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/night/tickRunner.ts server/src/night/tickRunner.test.ts
git commit -m "feat: add generic Redis-backed TickRunner with pause/resume"
```

---

## Task 10: Socket.io Redis adapter wiring

**Files:**
- Create: `server/src/redis/socketAdapter.ts`
- Create: `server/src/redis/socketAdapter.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/package.json` (add `@socket.io/redis-adapter` dependency)

**Interfaces:**
- Consumes: `getRedisClient()` from Task 2.
- Produces: `attachRedisAdapter(io: Server): void` — called from `createApp()` in `server/src/index.ts`.

- [ ] **Step 1: Add the dependency**

```bash
npm install @socket.io/redis-adapter --workspace=server
```

- [ ] **Step 2: Write the failing test**

Create `server/src/redis/socketAdapter.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { getRedisClient, closeRedisClient } from "./client.js";
import { attachRedisAdapter } from "./socketAdapter.js";

describe("attachRedisAdapter", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("replaces the default in-memory adapter with a Redis-backed one", () => {
    const io = new Server(createServer());
    attachRedisAdapter(io);
    expect(io.of("/").adapter.constructor.name).toBe("RedisAdapter");
    io.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './socketAdapter.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `server/src/redis/socketAdapter.ts`:

```typescript
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server } from "socket.io";
import { getRedisClient } from "./client.js";

export function attachRedisAdapter(io: Server): void {
  const pubClient = getRedisClient();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
}
```

Modify `server/src/index.ts` — add the import and call `attachRedisAdapter(io)` right after `io` is constructed:

```typescript
import { attachRedisAdapter } from "./redis/socketAdapter.js";
```

```typescript
export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: "*" },
  });
  attachRedisAdapter(io);

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
  });

  return { httpServer, io };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS, including the pre-existing `index.test.ts` bootstrap test (requires the `docker-compose` Redis to be running since `createApp()` now attaches the adapter on every call).

- [ ] **Step 6: Commit**

```bash
git add server/package.json package-lock.json server/src/redis/socketAdapter.ts server/src/redis/socketAdapter.test.ts server/src/index.ts
git commit -m "feat: wire @socket.io/redis-adapter into createApp for cross-instance broadcast"
```

---

## Task 11: Disconnect handler — silent reconnection + night pause/grace-period

**Files:**
- Create: `server/src/rooms/disconnectHandler.ts`
- Create: `server/src/rooms/disconnectHandler.test.ts`

**Interfaces:**
- Consumes: `getRoom`/`saveRoom` from `server/src/rooms/roomStore.ts` (Task 3), `pauseTick`/`resumeTick` from `createTickRunner` (Task 9).
- Produces: `createDisconnectHandler(deps): { handleDisconnect(roomCode, playerId), handleReconnect(roomCode, playerId) }` — will be wired to Socket.io's `connection`/`disconnect` events once the room-join flow exists (Phase 2).

- [ ] **Step 1: Write the failing test**

Create `server/src/rooms/disconnectHandler.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "./roomStore.js";
import { createDisconnectHandler } from "./disconnectHandler.js";

function fixture(roomCode: string, phase: GameState["phase"]): GameState {
  return {
    roomCode,
    phase,
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
    ],
    center: [],
    night:
      phase === "NIGHT"
        ? {
            tickIndex: 0,
            tickStartedAt: Date.now(),
            durationMs: 5000,
            paused: false,
            remainingMsAtPause: null,
            doppelgangerCopiedRoleId: null,
            doppelgangerCopiedPlayerId: null,
          }
        : null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("disconnectHandler", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  afterEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it("marks the player disconnected silently outside NIGHT, without pausing", async () => {
    await createRoom(fixture("ABCD", "DAY"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick } });

    await handler.handleDisconnect("ABCD", "p1");

    const room = await getRoom("ABCD");
    expect(room?.players.find((p) => p.id === "p1")?.connected).toBe(false);
    expect(pauseTick).not.toHaveBeenCalled();
  });

  it("pauses the tick on disconnect during NIGHT", async () => {
    await createRoom(fixture("EFGH", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const handler = createDisconnectHandler({
      tickRunner: { pauseTick, resumeTick },
      scheduleGraceTimeout: vi.fn(),
    });

    await handler.handleDisconnect("EFGH", "p1");

    expect(pauseTick).toHaveBeenCalledWith("EFGH");
    const room = await getRoom("EFGH");
    expect(room?.players.find((p) => p.id === "p1")?.connected).toBe(false);
  });

  it("resumes the tick if the player reconnects before grace expires", async () => {
    await createRoom(fixture("IJKL", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const scheduleGraceTimeout = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout });

    await handler.handleDisconnect("IJKL", "p1");
    await handler.handleReconnect("IJKL", "p1");

    expect(resumeTick).toHaveBeenCalledWith("IJKL");
    // the grace timeout callback must be a no-op if later invoked, since reconnection already resumed
    const graceCallback = scheduleGraceTimeout.mock.calls[0][0] as () => Promise<void>;
    resumeTick.mockClear();
    await graceCallback();
    expect(resumeTick).not.toHaveBeenCalled();
  });

  it("resumes the tick when the grace period expires with no reconnection", async () => {
    await createRoom(fixture("MNOP", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const scheduleGraceTimeout = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout });

    await handler.handleDisconnect("MNOP", "p1");
    const graceCallback = scheduleGraceTimeout.mock.calls[0][0] as () => Promise<void>;
    await graceCallback();

    expect(resumeTick).toHaveBeenCalledWith("MNOP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './disconnectHandler.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/rooms/disconnectHandler.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/disconnectHandler.ts server/src/rooms/disconnectHandler.test.ts
git commit -m "feat: add silent-reconnect and night pause/grace-period disconnect handler"
```

---

## Final verification

- [ ] Run the full suite once more end-to-end: `docker-compose up -d && npm run build -w shared && npm test`
Expected: all workspaces (`shared`, `server`) pass, 0 failures.
- [ ] Run `npm run lint` — expect no errors introduced by this phase's files.
