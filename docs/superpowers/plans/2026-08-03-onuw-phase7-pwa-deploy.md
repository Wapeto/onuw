# ONUW Phase 7 — Polish PWA & déploiement Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the PWA polish (installable manifest, offline app-shell service worker, "tête baissée" onboarding notice, fullscreen/orientation final pass) and the Vercel deployment wiring (`api/socket-io.ts`, `vercel.json`, workspace changes) that Phase 7 of `docs/superpowers/plans/2026-07-28-onuw-web-app.md` calls for, plus the two deployment-blocking prerequisites flagged by earlier phases' final reviews (no rate limiting on `CREATE_ROOM`/`JOIN_ROOM`, and a process-local disconnect-grace `Set` that breaks across Vercel Function instances).

**Architecture:** No new runtime dependencies. The service worker is hand-written (matches this project's existing "no XState, no extra deps" philosophy) and built via a second Rollup entry point in the existing Vite config rather than a plugin. The Vercel Function at `api/socket-io.ts` is a 3-line adapter that imports and reuses `createApp()` from `@onuw/server` unchanged — verified against Vercel's current (2026-07-06) official WebSockets docs, which show this exact `http.Server`-default-export shape for Socket.IO. `@onuw/server` gains a `main`/`types` entry point (mirroring `@onuw/shared`) so it can be imported by name from the new `api` workspace.

**Tech Stack:** No additions. Uses the existing Node/Socket.io/Redis server stack and Vite/React client stack already in place from Phases 0–6.

## Global Constraints

- Every night tick still runs unconditionally for every role, dummy or not — nothing in this phase touches `NIGHT_ORDER`/tick timing (from `onuw-web-spec.md` §3, unchanged since Phase 1).
- **Gameplay stays online-only.** The service worker caches the app shell (HTML/JS/CSS) only — it must never intercept or cache Socket.io traffic. (Phase 7 deliverable line, `docs/superpowers/plans/2026-07-28-onuw-web-app.md:220`.)
- **Fullscreen forced + back-navigation blocked during `NIGHT`** (already implemented in `useFullscreen`, Phase 4) — this phase only adds a best-effort orientation lock alongside it, it does not change when fullscreen activates.
- **Onboarding notice must be skippable per room via a "don't show again" toggle**, shown once before the first night of a given room/session (`onuw-web-spec.md` §5, "un toggle 'ne plus afficher' dans les settings du groupe/session").
- **Client forces `transports: ['websocket']`** (already done, Phase 5) — this phase adds the Socket.io `path` override needed for the `/api/socket-io/socket.io` convention in production, without changing local dev behavior.
- **State lives in Redis, never in a process-local variable** — this is the hosting constraint that makes the disconnect-grace fix in Task 2 mandatory before any multi-instance deployment (`docs/superpowers/plans/2026-07-28-onuw-web-app.md:187`).
- **A small per-socket token-bucket guards `CREATE_ROOM`/`JOIN_ROOM`** before any public deployment (`docs/superpowers/plans/2026-07-28-onuw-web-app.md:232`) — not a global limiter, not tied to Redis.
- Run `npm run test`, `npm run build`, and `npm run lint` from the repo root after each task; all three must pass before a task is considered done.

---

### Task 1: Rate limit `CREATE_ROOM`/`JOIN_ROOM` with a per-socket token bucket

**Files:**
- Create: `server/src/rooms/rateLimiter.ts`
- Create: `server/src/rooms/rateLimiter.test.ts`
- Modify: `server/src/rooms/roomEvents.ts`
- Modify: `server/src/rooms/roomEvents.test.ts`

**Interfaces:**
- Produces: `createRateLimiter(options: { capacity: number; refillMs: number; now?: () => number }): { tryConsume(): boolean }` — a pure, injectable-clock token bucket. `tryConsume()` returns `true` and consumes one token if available, `false` otherwise, lazily refilling based on elapsed time since the last refill.
- Consumes (in `roomEvents.ts`): nothing new from other tasks.

- [ ] **Step 1: Write the failing test for the token bucket**

Create `server/src/rooms/rateLimiter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

describe("createRateLimiter", () => {
  it("allows up to `capacity` consumptions with no time passing", () => {
    const limiter = createRateLimiter({ capacity: 3, refillMs: 1000 });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("refills one token per refillMs elapsed, using the injected clock", () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 1, refillMs: 1000, now: () => now });

    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);

    now = 999;
    expect(limiter.tryConsume()).toBe(false);

    now = 1000;
    expect(limiter.tryConsume()).toBe(true);
  });

  it("never refills past capacity even after a long idle period", () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 2, refillMs: 1000, now: () => now });
    limiter.tryConsume();
    limiter.tryConsume();

    now = 1_000_000;
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w server -- rateLimiter`
Expected: FAIL — `./rateLimiter.js` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/rooms/rateLimiter.ts`:

```ts
export interface RateLimiterOptions {
  capacity: number;
  refillMs: number;
  now?: () => number;
}

export interface RateLimiter {
  tryConsume(): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillMs, now = Date.now } = options;
  let tokens = capacity;
  let lastRefill = now();

  function refill(): void {
    const elapsed = now() - lastRefill;
    if (elapsed < refillMs) return;
    const refilled = Math.floor(elapsed / refillMs);
    tokens = Math.min(capacity, tokens + refilled);
    lastRefill += refilled * refillMs;
  }

  return {
    tryConsume(): boolean {
      refill();
      if (tokens <= 0) return false;
      tokens -= 1;
      return true;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w server -- rateLimiter`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/rateLimiter.ts server/src/rooms/rateLimiter.test.ts
git commit -m "feat: add a per-socket token-bucket rate limiter"
```

- [ ] **Step 6: Write the failing integration test for the socket-level limit**

In `server/src/rooms/roomEvents.test.ts`, add (near the other `CREATE_ROOM` tests):

```ts
  it("rejects CREATE_ROOM after the per-socket burst limit is exceeded", async () => {
    const host = await connect();
    let lastError: { message: string } | undefined;
    let created = 0;

    for (let i = 0; i < 12; i++) {
      const result = await new Promise<{ type: "created" } | { type: "error"; message: string }>((resolve) => {
        host.once("ROOM_CREATED", () => resolve({ type: "created" }));
        host.once("ROOM_ERROR", (payload) => resolve({ type: "error", message: payload.message }));
        host.emit("CREATE_ROOM", { pseudo: `Player${i}` });
      });
      if (result.type === "created") created++;
      else lastError = { message: result.message };
    }

    expect(created).toBeLessThan(12);
    expect(lastError?.message).toMatch(/too many|slow down/i);
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm run test -w server -- roomEvents`
Expected: FAIL — all 12 `CREATE_ROOM` calls currently succeed, so `created` is `12`.

- [ ] **Step 8: Wire the rate limiter into `registerRoomEvents`**

In `server/src/rooms/roomEvents.ts`, add the import near the top (after the `createDisconnectHandler` import):

```ts
import { createRateLimiter } from "./rateLimiter.js";
```

Inside `registerRoomEvents`, right after `let membership: Membership | null = null;`, add:

```ts
  // One bucket per connected socket, covering both mutating room-creation
  // events, so a spamming client can't flood Redis with ghost rooms or
  // hammer the withRoom CAS loop on JOIN_ROOM (Phase 2/7 final-review note).
  const mutationLimiter = createRateLimiter({ capacity: 5, refillMs: 3000 });
```

Then, as the very first line inside both `socket.on("CREATE_ROOM", (payload) => {` and `socket.on("JOIN_ROOM", (payload) => {` handlers — before `void (async () => {` — add:

```ts
    if (!mutationLimiter.tryConsume()) {
      socket.emit("ROOM_ERROR", { message: "too many requests, slow down" });
      return;
    }
```

So `CREATE_ROOM` becomes:

```ts
  socket.on("CREATE_ROOM", (payload) => {
    if (!mutationLimiter.tryConsume()) {
      socket.emit("ROOM_ERROR", { message: "too many requests, slow down" });
      return;
    }
    void (async () => {
      try {
        const parsed = createRoomPayloadSchema.safeParse(payload);
        // ... unchanged ...
```

and `JOIN_ROOM` becomes:

```ts
  socket.on("JOIN_ROOM", (payload) => {
    if (!mutationLimiter.tryConsume()) {
      socket.emit("ROOM_ERROR", { message: "too many requests, slow down" });
      return;
    }
    void (async () => {
      try {
        const parsed = joinRoomPayloadSchema.safeParse(payload);
        // ... unchanged ...
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run test -w server -- roomEvents`
Expected: PASS — `created` is capped at 5, and the 6th+ attempts return the rate-limit `ROOM_ERROR`.

- [ ] **Step 10: Run the full server suite and the build**

Run: `npm run test -w server && npm run build -w server`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add server/src/rooms/roomEvents.ts server/src/rooms/roomEvents.test.ts
git commit -m "feat: rate limit CREATE_ROOM/JOIN_ROOM per socket"
```

---

### Task 2: Fix the disconnect grace period so it survives across Vercel Function instances

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `server/src/rooms/disconnectHandler.ts`
- Modify: `server/src/rooms/disconnectHandler.test.ts`

**Interfaces:**
- Produces: `NightState.graceUntil?: number` — an epoch-ms deadline for the currently-open disconnect grace period, persisted in Redis via the existing `GameState` document. `NightState.graceForPlayerId?: string` — the id of the player whose disconnect opened that grace period. Both `undefined`/absent together means no grace period is open; they are always set and cleared together.
- Consumes: `getRoom`/`saveRoom` from `./roomStore.js` (existing, Phase 1).

**Context:** Today, `createDisconnectHandler` tracks "is a grace period pending for this player" in a local `Set<string>` keyed by `roomCode:playerId` — so it's already scoped to the specific player who disconnected. On Vercel, a disconnect handled by one Function instance and the matching reconnect handled by a different instance (the normal case — see `docs/superpowers/plans/2026-07-28-onuw-web-app.md:187`) never share that `Set`, so the immediate-resume-on-reconnect path silently misses and the room stays paused for the full 40s grace window every time. The fix moves the "is there an open grace period, and for which player" fact into `NightState` in Redis (as the master plan's own prerequisite note suggests), so any instance can make the correct decision — **and it must preserve the existing per-player scoping**: a reconnect from a player who was never disconnected must never resume a grace period that another player's disconnect opened. (An earlier draft of this fix stored only a room-level `graceUntil` with no player scoping, which would let *any* player's reconnect prematurely resume the tick while a different player is still gone — that bug is why `graceForPlayerId` exists below; do not drop it.)

- [ ] **Step 1: Add the optional fields to `NightState`**

In `shared/src/types.ts`, extend the interface (it currently ends at `resolvedActions?: ...`):

```ts
export interface NightState {
  tickIndex: number;
  tickStartedAt: number;
  durationMs: number;
  paused: boolean;
  remainingMsAtPause: number | null;
  doppelgangerCopiedRoleId: RoleId | null;
  doppelgangerCopiedPlayerId: string | null;
  resolvedActions?: Record<string, { phase1?: boolean; phase2?: boolean }>;
  graceUntil?: number;
  graceForPlayerId?: string;
}
```

This is additive and optional, so every existing `NightState` object literal elsewhere in the codebase (tests, `tickRunner.ts`, `actionResolvers.ts`) keeps compiling unchanged.

- [ ] **Step 2: Run the shared build to confirm it still compiles**

Run: `npm run build -w shared`
Expected: PASS

- [ ] **Step 3: Write the failing tests**

Replace the full contents of `server/src/rooms/disconnectHandler.test.ts` with:

```ts
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

  it("pauses the tick and records a grace deadline for the disconnecting player during NIGHT", async () => {
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
    expect(room?.night?.graceUntil).toBeTypeOf("number");
    expect(room?.night?.graceForPlayerId).toBe("p1");
  });

  it("does not resume the tick when a different player reconnects during another player's grace period", async () => {
    await createRoom(fixture("UVWX", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const handler = createDisconnectHandler({
      tickRunner: { pauseTick, resumeTick },
      scheduleGraceTimeout: vi.fn(),
    });

    // p1 disconnects and opens a grace period; p2 was never disconnected but
    // its socket reconnects anyway (a normal event — phone lock/unlock, a
    // tab refresh, a brief network blip). That must NOT resume p1's tick.
    await handler.handleDisconnect("UVWX", "p1");
    await handler.handleReconnect("UVWX", "p2");

    expect(resumeTick).not.toHaveBeenCalled();
    const room = await getRoom("UVWX");
    expect(room?.night?.graceUntil).toBeTypeOf("number");
    expect(room?.night?.graceForPlayerId).toBe("p1");
  });

  it("resumes the tick and clears the grace deadline if the player reconnects before it expires", async () => {
    await createRoom(fixture("IJKL", "NIGHT"));
    const pauseTick = vi.fn();
    const resumeTick = vi.fn();
    const scheduleGraceTimeout = vi.fn();
    const handler = createDisconnectHandler({ tickRunner: { pauseTick, resumeTick }, scheduleGraceTimeout });

    await handler.handleDisconnect("IJKL", "p1");
    await handler.handleReconnect("IJKL", "p1");

    expect(resumeTick).toHaveBeenCalledWith("IJKL");
    const room = await getRoom("IJKL");
    expect(room?.night?.graceUntil).toBeUndefined();
    expect(room?.night?.graceForPlayerId).toBeUndefined();

    // the grace timeout callback must be a no-op if later invoked, since reconnection already cleared it
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
    const room = await getRoom("MNOP");
    expect(room?.night?.graceUntil).toBeUndefined();
    expect(room?.night?.graceForPlayerId).toBeUndefined();
  });

  it("resumes on reconnect even when handled by a different handler instance (cross-instance)", async () => {
    await createRoom(fixture("QRST", "NIGHT"));
    // Two independent createDisconnectHandler() instances share no in-memory
    // state, simulating a disconnect and its matching reconnect landing on two
    // different Vercel Function instances. The only thing that can make
    // handleReconnect resume correctly here is the graceUntil/graceForPlayerId
    // persisted in Redis by the other instance.
    const instanceA = createDisconnectHandler({
      tickRunner: { pauseTick: vi.fn(), resumeTick: vi.fn() },
      scheduleGraceTimeout: vi.fn(),
    });
    const resumeTickB = vi.fn();
    const instanceB = createDisconnectHandler({ tickRunner: { pauseTick: vi.fn(), resumeTick: resumeTickB } });

    await instanceA.handleDisconnect("QRST", "p1");
    await instanceB.handleReconnect("QRST", "p1");

    expect(resumeTickB).toHaveBeenCalledWith("QRST");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -w server -- disconnectHandler`
Expected: FAIL — `graceUntil`/`graceForPlayerId` are never set on the Redis-backed room (current code only tracks the local `Set`), so the cross-instance test and the `graceUntil`/`graceForPlayerId` assertions fail.

- [ ] **Step 5: Rewrite the implementation**

Replace the full contents of `server/src/rooms/disconnectHandler.ts` with:

```ts
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
    const room = await getRoom(roomCode);
    if (!room || !room.night) return;
    await saveRoom({
      ...room,
      night: { ...room.night, graceUntil: grace?.until, graceForPlayerId: grace?.playerId },
      updatedAt: Date.now(),
    });
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w server -- disconnectHandler`
Expected: PASS (6/6)

- [ ] **Step 7: Run the full server suite, shared suite, and build**

Run: `npm run test -w shared && npm run test -w server && npm run build -w shared && npm run build -w server`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add shared/src/types.ts server/src/rooms/disconnectHandler.ts server/src/rooms/disconnectHandler.test.ts
git commit -m "fix: persist the night disconnect grace deadline in Redis so it survives across Function instances"
```

---

### Task 3: PWA manifest and app icon

**Files:**
- Create: `client/public/app-icon.svg`
- Create: `client/public/manifest.json`
- Create: `client/src/manifest.test.ts`
- Modify: `client/index.html`

**Interfaces:**
- Produces: `/manifest.json` (served statically from `client/public/`), referenced by `client/index.html`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `client/src/manifest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));

describe("manifest.json", () => {
  it("declares the fields required for PWA installability", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.name).toBe("One Night Ultimate Werewolf");
    expect(manifest.short_name).toBe("ONUW");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.sizes).toBeTruthy();
      expect(icon.type).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w client -- manifest`
Expected: FAIL — `client/public/manifest.json` does not exist yet.

- [ ] **Step 3: Create the app icon**

Create `client/public/app-icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="256" fill="#0f0f14"/>
  <path
    d="M296 96a176 176 0 1 0 120 296 200 200 0 0 1-120-296Z"
    fill="#863bff"
  />
  <circle cx="196" cy="266" r="14" fill="#0f0f14"/>
</svg>
```

(A crescent moon on a dark disc, with a single closed-eye dot — matches the game's "night"/eyes-closed anti-tell theme, and reuses the existing brand accent `#863bff` from `client/public/favicon.svg`.)

- [ ] **Step 4: Create the manifest**

Create `client/public/manifest.json`:

```json
{
  "name": "One Night Ultimate Werewolf",
  "short_name": "ONUW",
  "description": "Jouez à One Night Ultimate Werewolf en multi-device, sans app à installer sur chaque téléphone.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0f0f14",
  "theme_color": "#863bff",
  "icons": [
    {
      "src": "/app-icon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w client -- manifest`
Expected: PASS

- [ ] **Step 6: Link the manifest from `index.html`**

In `client/index.html`, replace the `<head>` contents:

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#863bff" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>One Night Ultimate Werewolf</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(`lang` corrected to `fr` to match the app's UI language, already French throughout `client/src/pages/*.tsx`.)

- [ ] **Step 7: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/public/app-icon.svg client/public/manifest.json client/src/manifest.test.ts client/index.html
git commit -m "feat: add an installable PWA manifest and app icon"
```

---

### Task 4: Offline app-shell service worker

**Files:**
- Create: `client/src/sw.ts`
- Create: `client/src/sw.test.ts`
- Create: `client/src/registerServiceWorker.ts`
- Create: `client/src/registerServiceWorker.test.ts`
- Create: `client/tsconfig.sw.json`
- Modify: `client/tsconfig.app.json`
- Modify: `client/tsconfig.json`
- Modify: `client/vite.config.ts`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Produces: `isCacheableGet(request: { method: string; url: string }, origin: string): boolean`, `SHELL_CACHE_NAME`, `SHELL_FALLBACK_PATH` (from `sw.ts`); `registerServiceWorker(container: Pick<ServiceWorkerContainer, "register"> | undefined): void` (from `registerServiceWorker.ts`).
- Consumes: nothing from other tasks. `main.tsx` calls `registerServiceWorker` guarded by `import.meta.env.PROD`, so local `npm run dev` never registers a service worker.

**Context:** `sw.ts` runs in the `ServiceWorkerGlobalScope`, which needs the `WebWorker` lib, while the rest of the client app runs in `DOM`+`ES2023` (`client/tsconfig.app.json`). Mixing the two libs in one `tsconfig` causes real type conflicts (`self`, `fetch`, event types), so `sw.ts` gets its own `tsconfig.sw.json` project — the same pattern already used for `vite.config.ts`'s separate `tsconfig.node.json`.

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `client/src/sw.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isCacheableGet, SHELL_CACHE_NAME, SHELL_FALLBACK_PATH } from "./sw";

describe("isCacheableGet", () => {
  it("accepts same-origin GET requests", () => {
    expect(isCacheableGet({ method: "GET", url: "https://onuw.app/assets/main.js" }, "https://onuw.app")).toBe(true);
  });

  it("rejects non-GET requests", () => {
    expect(isCacheableGet({ method: "POST", url: "https://onuw.app/assets/main.js" }, "https://onuw.app")).toBe(
      false,
    );
  });

  it("rejects cross-origin requests", () => {
    expect(isCacheableGet({ method: "GET", url: "https://cdn.example.com/lib.js" }, "https://onuw.app")).toBe(false);
  });
});

describe("service worker shell constants", () => {
  it("names the shell cache and the offline fallback path", () => {
    expect(SHELL_CACHE_NAME).toBe("onuw-shell-v1");
    expect(SHELL_FALLBACK_PATH).toBe("/index.html");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w client -- sw.test`
Expected: FAIL — `./sw` does not exist.

- [ ] **Step 3: Add the service worker's own tsconfig project**

Create `client/tsconfig.sw.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.sw.tsbuildinfo",
    "target": "es2022",
    "lib": ["ES2023", "WebWorker"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/sw.ts", "src/sw.test.ts"]
}
```

`sw.test.ts` must be included here too, alongside `sw.ts` — TypeScript's `exclude` only prunes the initial root-file list; it doesn't stop an excluded file from being pulled back into a project if another *included* file in that project imports it. Since `sw.test.ts` imports `./sw`, it has to live in the same project as `sw.ts` (this project, with the `WebWorker` lib) rather than in `tsconfig.app.json`'s DOM-lib project, or `tsc -b` type-checks `sw.ts` twice — once correctly here, once incorrectly under `tsconfig.app.json` via the transitive import — and the second pass fails with `ServiceWorkerGlobalScope`/implicit-`any` errors.

In `client/tsconfig.app.json`, exclude `sw.ts` **and `sw.test.ts`** from the DOM-lib app project, for the same reason (add the `exclude` key after `include`):

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "allowArbitraryExtensions": true,
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["src/sw.ts", "src/sw.test.ts"]
}
```

In `client/tsconfig.json`, add the new project reference:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.sw.json" }
  ]
}
```

- [ ] **Step 4: Write the service worker**

Create `client/src/sw.ts`:

```ts
declare const self: ServiceWorkerGlobalScope;

export const SHELL_CACHE_NAME = "onuw-shell-v1";
export const SHELL_FALLBACK_PATH = "/index.html";

export function isCacheableGet(request: { method: string; url: string }, origin: string): boolean {
  if (request.method !== "GET") return false;
  return new URL(request.url).origin === origin;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== SHELL_CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Runtime-caches the app shell (HTML/JS/CSS) only, network-first with a
// cache fallback for offline. Never intercepts Socket.io traffic: gameplay
// uses a WebSocket connection, not fetch(), so it never reaches this
// listener (Phase 7 constraint: "coquille offline seulement").
self.addEventListener("fetch", (event) => {
  if (!isCacheableGet(event.request, self.location.origin)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(SHELL_CACHE_NAME);
        void cache.put(event.request, response.clone());
        return response;
      } catch {
        const cache = await caches.open(SHELL_CACHE_NAME);
        const cached = (await cache.match(event.request)) ?? (await cache.match(SHELL_FALLBACK_PATH));
        if (cached) return cached;
        throw new Error("offline and no cached response available");
      }
    })(),
  );
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w client -- sw.test`
Expected: PASS (4/4)

- [ ] **Step 6: Type-check the service worker project**

Run: `cd client && npx tsc -p tsconfig.sw.json && cd ..`
Expected: PASS, no errors.

- [ ] **Step 7: Write the failing test for registration**

Create `client/src/registerServiceWorker.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { registerServiceWorker } from "./registerServiceWorker";

describe("registerServiceWorker", () => {
  it("registers /sw.js as a module worker when a container is available", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    registerServiceWorker({ register });
    expect(register).toHaveBeenCalledWith("/sw.js", { type: "module" });
  });

  it("does nothing when no service worker container is available", () => {
    expect(() => registerServiceWorker(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npm run test -w client -- registerServiceWorker`
Expected: FAIL — `./registerServiceWorker` does not exist.

- [ ] **Step 9: Write the registration helper**

Create `client/src/registerServiceWorker.ts`:

```ts
export function registerServiceWorker(
  serviceWorkerContainer: Pick<ServiceWorkerContainer, "register"> | undefined,
): void {
  if (!serviceWorkerContainer) return;
  void serviceWorkerContainer.register("/sw.js", { type: "module" });
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm run test -w client -- registerServiceWorker`
Expected: PASS (2/2)

- [ ] **Step 11: Wire registration into `main.tsx`, gated to production builds**

Replace `client/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './registerServiceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Only in production builds: `npm run dev` never registers a service worker,
// so local development is unaffected by shell caching.
if (import.meta.env.PROD) {
  registerServiceWorker(navigator.serviceWorker);
}
```

- [ ] **Step 12: Build the service worker to a stable root-level path**

Replace `client/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // `sw.ts` is a second, self-contained entry (no imports, no shared
      // chunks) so it can be emitted as a single stable-named file at the
      // dist root instead of a hashed asset — the browser needs a fixed
      // URL to register it.
      input: {
        main: 'index.html',
        sw: 'src/sw.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => (chunkInfo.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
```

- [ ] **Step 13: Build and verify the service worker lands at the dist root**

Run: `npm run build -w client && ls client/dist/sw.js`
Expected: `npm run build -w client` succeeds, and `client/dist/sw.js` exists.

- [ ] **Step 14: Run the full client suite**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add client/src/sw.ts client/src/sw.test.ts client/src/registerServiceWorker.ts client/src/registerServiceWorker.test.ts client/tsconfig.sw.json client/tsconfig.app.json client/tsconfig.json client/vite.config.ts client/src/main.tsx
git commit -m "feat: add an offline app-shell service worker, built as a stable dist/sw.js"
```

---

### Task 5: "Tête baissée" onboarding notice, shown once per room

**Files:**
- Create: `client/src/onboardingStorage.ts`
- Create: `client/src/onboardingStorage.test.ts`
- Create: `client/src/components/OnboardingNotice.tsx`
- Create: `client/src/components/OnboardingNotice.test.tsx`
- Modify: `client/src/pages/RoleSelect.tsx`
- Modify: `client/src/pages/RoleSelect.test.tsx`
- Modify: `client/src/test/setup.ts`
- Modify: `client/vitest.config.ts`

**Interfaces:**
- Produces: `isOnboardingDismissed(roomCode: string): boolean`, `dismissOnboarding(roomCode: string): void` (from `onboardingStorage.ts`); `<OnboardingNotice onContinue={(dontShowAgain: boolean) => void} />` (from `OnboardingNotice.tsx`).
- Consumes: `RoleSelect.tsx`'s existing `currentTick`/`routeRoomCode`/`navigate` (Phase 3/4, unchanged).

**Context:** `RoleSelect.tsx` currently navigates straight to `/room/:roomCode/night` the instant `currentTick` appears (the night has started). This task inserts the onboarding notice as an interstitial on that same transition: shown once per room, then dismissed by default, per `onuw-web-spec.md` §5 — *"une seule fois, pas à chaque partie si le groupe a déjà joué"* ("shown once, not every game once the group has already played"). Since `Reveal.tsx`'s "Rejouer" button (Task 6/Phase 6, already built) keeps the same room and restarts straight back into `ROLE_SELECT` — the whole point of §5's separate "Rejouer vite" flow being zero re-scanning, zero repeated friction between rounds — the notice must not reappear on every replay round by default. The "don't show again" checkbox therefore starts **checked**: the default action (click "Continuer" without touching it) dismisses the notice for this room going forward, and unchecking it is the explicit opt-in for a group that wants the reminder repeated every round anyway.

- [ ] **Step 1: Write the failing tests for the storage helper**

Create `client/src/onboardingStorage.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { isOnboardingDismissed, dismissOnboarding } from "./onboardingStorage";

describe("onboardingStorage", () => {
  afterEach(() => localStorage.clear());

  it("is not dismissed by default", () => {
    expect(isOnboardingDismissed("ABCDE")).toBe(false);
  });

  it("remembers dismissal per room code", () => {
    dismissOnboarding("ABCDE");
    expect(isOnboardingDismissed("ABCDE")).toBe(true);
    expect(isOnboardingDismissed("ZZZZZ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w client -- onboardingStorage`
Expected: FAIL — `./onboardingStorage` does not exist.

- [ ] **Step 3: Write the storage helper**

Create `client/src/onboardingStorage.ts`:

```ts
const KEY_PREFIX = "onuw:onboarding-dismissed:";

export function isOnboardingDismissed(roomCode: string): boolean {
  return localStorage.getItem(KEY_PREFIX + roomCode) === "1";
}

export function dismissOnboarding(roomCode: string): void {
  localStorage.setItem(KEY_PREFIX + roomCode, "1");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w client -- onboardingStorage`
Expected: PASS (2/2)

- [ ] **Step 5: Write the failing tests for the component**

Create `client/src/components/OnboardingNotice.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnboardingNotice from "./OnboardingNotice";

describe("OnboardingNotice", () => {
  it("shows the tête baissée reminder", () => {
    render(<OnboardingNotice onContinue={vi.fn()} />);
    expect(screen.getByText(/tête baissée/i)).toBeInTheDocument();
  });

  it("calls onContinue(true) by default (checkbox starts checked)", () => {
    const onContinue = vi.fn();
    render(<OnboardingNotice onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(onContinue).toHaveBeenCalledWith(true);
  });

  it("calls onContinue(false) when the 'don't show again' checkbox is unchecked", () => {
    const onContinue = vi.fn();
    render(<OnboardingNotice onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /ne plus afficher/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(onContinue).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test -w client -- OnboardingNotice`
Expected: FAIL — `./OnboardingNotice` does not exist.

- [ ] **Step 7: Write the component**

Create `client/src/components/OnboardingNotice.tsx`:

```tsx
import { useState } from "react";

export interface OnboardingNoticeProps {
  onContinue: (dontShowAgain: boolean) => void;
}

function OnboardingNotice({ onContinue }: OnboardingNoticeProps) {
  // Checked by default: onuw-web-spec.md §5 asks for "shown once, not every
  // game once the group has already played" — since Reveal's "Rejouer" keeps
  // the same room and is explicitly designed for chaining rounds with zero
  // friction (§5 "Rejouer vite"), the default action (click Continuer
  // without touching the checkbox) must dismiss the notice for this room,
  // not require an opt-in click every time. Unchecking is the escape hatch
  // for a group that wants the reminder repeated anyway.
  const [dontShowAgain, setDontShowAgain] = useState(true);

  return (
    <div>
      <h1>Avant de commencer</h1>
      <p>Tête baissée, chacun regarde son propre écran.</p>
      <label>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Ne plus afficher pour cette partie
      </label>
      <button onClick={() => onContinue(dontShowAgain)}>Continuer</button>
    </div>
  );
}

export default OnboardingNotice;
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test -w client -- OnboardingNotice`
Expected: PASS (3/3)

- [ ] **Step 9: Clear `localStorage` between tests globally**

In `client/src/test/setup.ts`, add the clear alongside the existing `cleanup()` — guarded, since `manifest.test.ts` (Task 3) opts into the plain `node` test environment via `// @vitest-environment node`, which has no jsdom-backed `localStorage` at all:

```ts
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  // Some test files (e.g. manifest.test.ts) opt into the plain "node"
  // environment via `// @vitest-environment node`, where no jsdom-backed
  // `localStorage` exists — guard so this global hook doesn't blow those up.
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});
```

Also add `execArgv: ["--no-experimental-webstorage"]` to `client/vitest.config.ts`'s `test` config. Node 22.4+ ships an experimental global `localStorage` accessor that shadows jsdom's implementation unless disabled — without this flag, `localStorage` reads as `undefined` inside jsdom-environment tests on newer Node versions, breaking every test that touches it (this task's new tests included):

```ts
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      execArgv: ["--no-experimental-webstorage"],
    },
  }),
);
```

(If `client/vitest.config.ts` already has other `test` options beyond `environment`/`setupFiles` by the time this task runs, add `execArgv` alongside them rather than replacing the whole file — the snippet above shows the file's current shape as of Task 4.)

- [ ] **Step 10: Update the existing RoleSelect test that now regresses**

In `client/src/pages/RoleSelect.test.tsx`, replace the `"navigates to the night page once currentTick is set"` test with:

```tsx
  it("shows the onboarding notice once currentTick is set, then navigates to night on continue", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText(/tête baissée/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(screen.getByText("night-page")).toBeInTheDocument();
  });

  it("skips the onboarding notice when it was previously dismissed for this room", () => {
    localStorage.setItem("onuw:onboarding-dismissed:ABCDE", "1");
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText("night-page")).toBeInTheDocument();
  });

  it("persists the dismissal by default when continuing (checkbox starts checked)", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(localStorage.getItem("onuw:onboarding-dismissed:ABCDE")).toBe("1");
  });

  it("does not persist the dismissal when 'don't show again' is unchecked before continuing", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        currentTick: { tickIndex: 0, tickId: "seer", durationMs: 8000, active: false },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("checkbox", { name: /ne plus afficher/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(localStorage.getItem("onuw:onboarding-dismissed:ABCDE")).toBeNull();
  });
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npm run test -w client -- RoleSelect`
Expected: FAIL — `RoleSelect.tsx` still navigates straight to `/night` without showing `OnboardingNotice`.

- [ ] **Step 12: Wire the interstitial into `RoleSelect.tsx`**

In `client/src/pages/RoleSelect.tsx`, add the imports:

```ts
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { GameMode, RoleId } from "@onuw/shared";
import { ROLE_IDS, totalRoleCount, MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoleRecap from "../components/RoleRecap";
import OnboardingNotice from "../components/OnboardingNotice";
import { isOnboardingDismissed, dismissOnboarding } from "../onboardingStorage";
import { roleLabel } from "../roleLabels";
```

Replace the navigation effect and add the interstitial render, inside `RoleSelect`:

```tsx
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (currentTick && routeRoomCode) {
      if (isOnboardingDismissed(routeRoomCode)) {
        navigate(`/room/${routeRoomCode}/night`);
      } else {
        setShowOnboarding(true);
      }
    }
  }, [currentTick, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (showOnboarding && routeRoomCode) {
    return (
      <OnboardingNotice
        onContinue={(dontShowAgain) => {
          if (dontShowAgain) dismissOnboarding(routeRoomCode);
          navigate(`/room/${routeRoomCode}/night`);
        }}
      />
    );
  }

  if (!roleSelection) {
    return <p>Chargement de la configuration…</p>;
  }
```

(The rest of the component is unchanged — only the effect body, the new `showOnboarding` state, and the new early return before the existing `if (!roleSelection)` guard.)

- [ ] **Step 13: Run the test to verify it passes**

Run: `npm run test -w client -- RoleSelect`
Expected: PASS

- [ ] **Step 14: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add client/src/onboardingStorage.ts client/src/onboardingStorage.test.ts client/src/components/OnboardingNotice.tsx client/src/components/OnboardingNotice.test.tsx client/src/pages/RoleSelect.tsx client/src/pages/RoleSelect.test.tsx client/src/test/setup.ts
git commit -m "feat: show a dismissible tête-baissée onboarding notice before the first night"
```

---

### Task 6: Best-effort portrait orientation lock during the night, alongside fullscreen

**Files:**
- Modify: `client/src/hooks/useFullscreen.ts`
- Modify: `client/src/hooks/useFullscreen.test.ts`

**Interfaces:**
- Produces: no new exports — `useFullscreen(active: boolean)`'s existing signature and behavior are unchanged; it now also attempts (and releases) a portrait orientation lock.
- Consumes: nothing new.

**Context:** This is the "dernier passage fullscreen/orientation" line of the Phase 7 deliverable (`docs/superpowers/plans/2026-07-28-onuw-web-app.md:220`). Fullscreen-forcing and back-navigation-blocking during `NIGHT` already exist (Phase 4); this task's only addition is a best-effort `screen.orientation.lock("portrait")` alongside the existing `requestFullscreen()` call, released on cleanup exactly like the existing `exitFullscreen()` call. `ScreenOrientation.lock`/`.unlock` are unsupported on some browsers (notably iOS Safari) — the call is wrapped the same defensive way the existing `requestFullscreen()` call already is (`.catch(() => {})`), so unsupported browsers are unaffected.

- [ ] **Step 1: Write the failing tests**

In `client/src/hooks/useFullscreen.test.ts`, add two tests after the existing ones:

```ts
  it("attempts to lock screen orientation to portrait when active", () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(screen, "orientation", {
      value: { lock, unlock: vi.fn() },
      configurable: true,
    });

    renderHook(() => useFullscreen(true));

    expect(lock).toHaveBeenCalledWith("portrait");
  });

  it("unlocks screen orientation on cleanup", () => {
    const unlock = vi.fn();
    Object.defineProperty(screen, "orientation", {
      value: { lock: vi.fn().mockResolvedValue(undefined), unlock },
      configurable: true,
    });

    const { unmount } = renderHook(() => useFullscreen(true));
    unmount();

    expect(unlock).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w client -- useFullscreen`
Expected: FAIL — the two new assertions fail since `useFullscreen` never touches `screen.orientation`.

- [ ] **Step 3: Extend the hook**

Replace `client/src/hooks/useFullscreen.ts`:

```ts
import { useEffect } from "react";

export function useFullscreen(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    void document.documentElement.requestFullscreen?.().catch(() => {});
    void screen.orientation?.lock("portrait").catch(() => {});
    history.pushState(null, "", location.href);

    const blockBack = () => {
      history.pushState(null, "", location.href);
    };
    window.addEventListener("popstate", blockBack);

    return () => {
      window.removeEventListener("popstate", blockBack);
      screen.orientation?.unlock();
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [active]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w client -- useFullscreen`
Expected: PASS (5/5) — the existing file has 3 tests; this task adds 2.

- [ ] **Step 5: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useFullscreen.ts client/src/hooks/useFullscreen.test.ts
git commit -m "feat: attempt a best-effort portrait orientation lock alongside forced fullscreen during the night"
```

---

### Task 7: Environment-aware Socket.io URL/path resolution for production

**Files:**
- Create: `client/src/socketConfig.ts`
- Create: `client/src/socketConfig.test.ts`
- Modify: `client/src/hooks/useRoomSocket.ts`

**Interfaces:**
- Produces: `resolveSocketUrl(env: { VITE_SERVER_URL?: string; PROD?: boolean }): string | undefined`, `resolveSocketPath(env: { VITE_SOCKET_PATH?: string }): string | undefined`.
- Consumes: nothing from other tasks. Feeds Task 8's deployment env vars (`VITE_SOCKET_PATH=/api/socket-io/socket.io`, `VITE_SERVER_URL` left unset in production).

**Context:** Local dev keeps connecting to `http://localhost:3001` with Socket.io's default path exactly as today. In the Vercel deployment (Task 8), the client and the `api/socket-io.ts` Function share one domain, so the client must connect same-origin (`io(undefined, ...)`) and use the path convention Vercel's WebSockets docs specify for Socket.IO Functions: `path: '/api/socket-io/socket.io'`. Both are resolved through small pure functions so the branching is unit-testable without needing to stub `import.meta.env` in the hook's own test file (which already mocks the whole `socket.io-client` module and doesn't assert on call arguments — see `client/src/hooks/useRoomSocket.test.ts`).

- [ ] **Step 1: Write the failing tests**

Create `client/src/socketConfig.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSocketUrl, resolveSocketPath } from "./socketConfig";

describe("resolveSocketUrl", () => {
  it("defaults to localhost:3001 outside production when unset", () => {
    expect(resolveSocketUrl({})).toBe("http://localhost:3001");
  });

  it("resolves to same-origin (undefined) in production when unset", () => {
    expect(resolveSocketUrl({ PROD: true })).toBeUndefined();
  });

  it("prefers an explicit VITE_SERVER_URL in any environment", () => {
    expect(resolveSocketUrl({ VITE_SERVER_URL: "https://staging.example.com", PROD: true })).toBe(
      "https://staging.example.com",
    );
  });
});

describe("resolveSocketPath", () => {
  it("is undefined (socket.io's own default) when unset", () => {
    expect(resolveSocketPath({})).toBeUndefined();
  });

  it("uses an explicit VITE_SOCKET_PATH when provided", () => {
    expect(resolveSocketPath({ VITE_SOCKET_PATH: "/api/socket-io/socket.io" })).toBe("/api/socket-io/socket.io");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w client -- socketConfig`
Expected: FAIL — `./socketConfig` does not exist.

- [ ] **Step 3: Write the implementation**

Create `client/src/socketConfig.ts`:

```ts
export interface SocketEnv {
  VITE_SERVER_URL?: string;
  VITE_SOCKET_PATH?: string;
  PROD?: boolean;
}

export function resolveSocketUrl(env: SocketEnv): string | undefined {
  return env.VITE_SERVER_URL || (env.PROD ? undefined : "http://localhost:3001");
}

export function resolveSocketPath(env: SocketEnv): string | undefined {
  return env.VITE_SOCKET_PATH || undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w client -- socketConfig`
Expected: PASS (5/5)

- [ ] **Step 5: Use it in `useRoomSocket.ts`**

In `client/src/hooks/useRoomSocket.ts`, replace the `SOCKET_URL` constant and add the import:

```ts
import { resolveSocketPath, resolveSocketUrl } from "../socketConfig";
```

```ts
const SOCKET_URL = resolveSocketUrl(import.meta.env);
const SOCKET_PATH = resolveSocketPath(import.meta.env);
```

Then in the `io(...)` call inside the connection `useEffect`, add `path`:

```ts
    const socket: AppSocket = io(SOCKET_URL, {
      transports: ["websocket"],
      path: SOCKET_PATH,
      auth: stored.roomCode && stored.playerId && stored.reconnectToken ? stored : {},
    });
```

- [ ] **Step 6: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS — `useRoomSocket.test.ts` mocks `socket.io-client` entirely and doesn't assert on `io()`'s arguments, so this change doesn't affect it.

- [ ] **Step 7: Commit**

```bash
git add client/src/socketConfig.ts client/src/socketConfig.test.ts client/src/hooks/useRoomSocket.ts
git commit -m "feat: resolve the Socket.io URL/path from env, defaulting to same-origin in production"
```

---

### Task 8: Vercel deployment wiring (`api/socket-io.ts`, workspace, `vercel.json`)

**Files:**
- Modify: `package.json` (root)
- Modify: `package-lock.json` (root) — `npm install` in Step 5 registers the new `api` workspace here; commit it alongside the rest, an out-of-sync lockfile fails `npm ci`
- Modify: `server/package.json`
- Modify: `server/tsconfig.json`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/socket-io.ts`
- Create: `vercel.json`
- Create: `docs/deployment.md`

**Interfaces:**
- Produces: `api/socket-io.ts` exports the `http.Server` returned by `@onuw/server`'s `createApp()` as its default export (Vercel's documented shape for a Socket.IO Function — see the verification note below).
- Consumes: `createApp` from `@onuw/server` (Task-independent, already exists since Phase 0/1); `VITE_SOCKET_PATH`/`VITE_SERVER_URL` from Task 7 (set as deployment env vars, not code).

**Verification of the Vercel API shape used here:** Vercel's WebSockets documentation (`https://vercel.com/docs/functions/websockets`, last updated 2026-07-06 — fetched live for this plan rather than assumed, since it's a beta feature) shows the Socket.IO example as:

```ts
import http from 'http';
import { Server } from 'socket.io';

const server = http.createServer();
const io = new Server(server);
// ... io.on('connection', ...) ...

export default server;
```

i.e. a bare `http.Server` default export, no `.listen()` call — exactly what `createApp()` already returns via its `httpServer` field. The same doc's client snippet confirms the path convention already wired into `client/src/socketConfig.ts` in Task 7: `path: '/api/socket-io/socket.io'`, `transports: ['websocket']`.

**Manual, non-code prerequisites** (cannot be scripted or tested from this repo — call these out to whoever runs the actual deployment):
1. In the target Vercel project's dashboard, request/enable the **WebSockets** permission (the docs mark this feature "🔒 Permissions Required: WebSockets"; Vercel's own install helper is `npx plugins add vercel/vercel-plugin`).
2. Provision a Redis database from the Vercel Marketplace (Upstash) against the project, and copy its connection string.
3. In the Vercel project's Environment Variables settings, set `REDIS_URL` to that Upstash `rediss://...` connection string, and `VITE_SOCKET_PATH=/api/socket-io/socket.io` for the client build. Leave `VITE_SERVER_URL` unset so `resolveSocketUrl` (Task 7) resolves to same-origin in production.

- [ ] **Step 1: Give `@onuw/server` a package entry point**

In `server/package.json`, add `main`/`types` (matching `@onuw/shared`'s existing pattern). Only add the two new top-level `"main"`/`"types"` fields — leave the existing `dependencies` block (which correctly lists `"@onuw/shared": "*"`) untouched:

```json
{
  "name": "@onuw/server",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@onuw/shared": "*",
    "@socket.io/redis-adapter": "^8.3.0",
    "ioredis": "^5.11.1",
    "nanoid": "^6.0.0",
    "socket.io": "^4.8.0",
    "zod": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "socket.io-client": "^4.8.0",
    "tsx": "^4.19.0"
  }
}
```

In `server/tsconfig.json`, add `"declaration": true` so `dist/index.d.ts` is emitted:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 2: Build the server workspace and confirm the entry point resolves**

Run: `npm run build -w server && test -f server/dist/index.js && test -f server/dist/index.d.ts && echo OK`
Expected: `OK` — both files exist.

- [ ] **Step 3: Add the `api` workspace**

In root `package.json`, add `"api"` to `workspaces`:

```json
{
  "name": "onuw",
  "private": true,
  "type": "module",
  "workspaces": [
    "shared",
    "server",
    "client",
    "api"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm run test -w shared && npm run test -w server && npm run test -w client",
    "lint": "eslint .",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w client"
  },
  "devDependencies": {
    "concurrently": "^10.0.4",
    "eslint": "^10.8.0",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.65.0",
    "vitest": "^4.1.10"
  }
}
```

Create `api/package.json`:

```json
{
  "name": "@onuw/api",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "dependencies": {
    "@onuw/server": "*"
  }
}
```

Create `api/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 4: Write the Vercel Function**

Create `api/socket-io.ts`:

```ts
import { createApp } from "@onuw/server";

// Vercel's WebSockets docs (https://vercel.com/docs/functions/websockets)
// document a bare http.Server default export for Socket.IO Functions, with
// no .listen() call — createApp() already returns exactly that shape via
// httpServer, unmodified from local dev/test usage (server/src/index.ts).
const { httpServer } = createApp();

export default httpServer;
```

- [ ] **Step 5: Install the new workspace**

Run: `npm install`
Expected: succeeds and links `@onuw/server` into the `api` workspace's `node_modules` resolution path (standard npm workspaces symlink, the same mechanism already used for `@onuw/shared` inside `server`).

- [ ] **Step 6: Type-check the API function against the built server types**

Run: `cd api && npx tsc -p tsconfig.json && cd ..`
Expected: PASS, no errors — confirms `import { createApp } from "@onuw/server"` resolves to `server/dist/index.d.ts` from Step 1/2.

- [ ] **Step 7: Add `vercel.json`**

Create `vercel.json` at the repo root:

```json
{
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "outputDirectory": "client/dist"
}
```

(Reuses the existing root `npm run build` script — which already builds `shared`, then `server`, then `client` in that order — so `server/dist` exists with its declaration files before Vercel's Function bundler processes `api/socket-io.ts`, and `client/dist` is the static output Vercel serves.)

- [ ] **Step 8: Write the deployment doc**

Create `docs/deployment.md`:

```markdown
# Déploiement Vercel

Ce projet se déploie comme un seul projet Vercel : le client (`client/dist`,
statique) + `api/socket-io.ts` (Vercel Function Socket.io, WebSockets beta).

## Étapes manuelles (une seule fois, côté dashboard Vercel)

1. **Activer les WebSockets** sur le projet Vercel — fonctionnalité en beta
   publique nécessitant une permission dédiée. Voir
   `npx plugins add vercel/vercel-plugin` et
   https://vercel.com/docs/functions/websockets.
2. **Provisionner Redis (Upstash)** via le Marketplace Vercel, sur ce projet.
3. Dans les Environment Variables du projet Vercel, définir :
   - `REDIS_URL` — la chaîne de connexion `rediss://...` fournie par Upstash.
   - `VITE_SOCKET_PATH` = `/api/socket-io/socket.io`
   - `VITE_SERVER_URL` — **laisser non défini** (le client résout alors
     vers same-origin en production, voir `client/src/socketConfig.ts`).

## Ce qui est déjà automatisé par ce repo

- `vercel.json` définit `buildCommand`/`installCommand`/`outputDirectory`
  pour que Vercel construise `shared` → `server` → `client` dans l'ordre
  puis serve `client/dist`.
- `api/socket-io.ts` réutilise `createApp()` de `@onuw/server` sans
  dupliquer le wiring Socket.io/Redis — c'est le même code que celui testé
  en local et en CI via `server/src/index.test.ts`.
- Chaque push sur `master` redéploie automatiquement une fois le projet
  Vercel connecté au dépôt (comportement par défaut Vercel, aucune config
  supplémentaire requise).
```

- [ ] **Step 9: Run the full monorepo test suite, build, and lint**

Run: `npm run test && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json server/package.json server/tsconfig.json api/package.json api/tsconfig.json api/socket-io.ts vercel.json docs/deployment.md
git commit -m "feat: wire up Vercel deployment (api/socket-io.ts, vercel.json, server package entry point)"
```

---

## Final Verification

- [ ] Run the entire monorepo suite: `npm run test`
- [ ] Run the entire monorepo build: `npm run build`
- [ ] Run lint: `npm run lint`
- [ ] Confirm `client/dist/sw.js` and `client/dist/index.html` (referencing `/manifest.json`) both exist after the build.
- [ ] Confirm `server/dist/index.d.ts` exists and `api/socket-io.ts` type-checks against it (`cd api && npx tsc -p tsconfig.json`).

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** manifest + icon (Task 3), offline app-shell service worker (Task 4), "tête baissée" onboarding notice with a per-room "don't show again" toggle (Task 5), fullscreen/orientation final pass (Task 6), and the full Vercel deployment (`api/socket-io.ts`, Redis/Upstash provisioning documented, WebSockets beta flag documented, `vercel.json`, auto-deploy-on-push which is Vercel's default and needs no extra config) — all of Phase 7's master-plan deliverable line are covered. The two carried-over "prérequis" blocking public deployment (no rate limiting on `CREATE_ROOM`/`JOIN_ROOM`; the process-local disconnect-grace `Set`) are fixed in Tasks 1–2, ahead of the deployment task, as the master plan requires ("bloquant avant tout déploiement public" / "avant tout déploiement multi-instance").
- **Deliberately not built:** a maskable/multi-size PNG icon set — the single `sizes: "any"` SVG icon in Task 3 already satisfies Chrome's installability criteria (one icon ≥192px, one ≥512px — `"any"` covers both), and generating pixel-art assets isn't something this plan should fabricate. If real brand art shows up later, swapping `app-icon.svg` and adding more `icons` entries to `manifest.json` is a small, isolated follow-up, not a Phase 7 blocker.
- **Deliberately not built:** a distributed/Redis-backed timer for the disconnect grace timeout itself (Task 2) — only the *decision* of whether to resume needs to be cross-instance-safe (fixed), because the `setTimeout` that fires it lives on the same live WebSocket connection's Function instance for the grace window's 40s duration, well under Vercel's 5-minute Function duration cap that this whole architecture is already built around (`docs/superpowers/plans/2026-07-28-onuw-web-app.md:30`). Building a distributed timer here would be solving a problem the hosting model doesn't actually have.
- **Type-consistency check across tasks:** `NightState.graceUntil`/`graceForPlayerId` (Task 2) are optional and additive, so they don't ripple into the `NightState` object literals in `server/src/night/tickRunner.ts`, `server/src/roles/actionResolvers.ts`, `server/src/night/nightOrder.test.ts`, `server/src/night/nightActionEvents.test.ts`, `server/src/rooms/roomEvents.test.ts`, or `shared/src/types.test.ts` — verified by reading each of those files before writing this plan. `resolveSocketUrl`/`resolveSocketPath` (Task 7) and `VITE_SOCKET_PATH` (Task 8's deployment doc) use the exact same env var names and the exact path string Vercel's own docs specify. `registerServiceWorker` (Task 4) registers with `{ type: "module" }`, matching that `sw.ts` (Task 4) has real named exports and is therefore built as an ES module chunk, not a classic script — missed once during planning and corrected before finalizing this document.
- **Correction made during Task 2's review loop:** the first version of this plan specified `graceUntil` alone (room-scoped, no player scoping), which the task text already promised "6/6" tests for but only listed 5 — the missing 6th test would have been exactly the one that catches this. A task reviewer caught the gap empirically (a different, never-disconnected player's reconnect prematurely resumed another player's grace period) before it shipped. Fixed by adding `graceForPlayerId` alongside `graceUntil`, restoring the per-player scoping the original in-memory `Set` (keyed by `roomCode:playerId`) already had, plus the regression test above. Recorded here so the fix's rationale survives independent of the ledger.
- **Correction made during Task 5's review loop:** the first version of this plan defaulted `OnboardingNotice`'s "don't show again" checkbox to unchecked, so the notice would silently reappear on every "Rejouer" round unless a player proactively opted in to suppressing it each time — a task reviewer traced the replay flow (`Reveal.tsx` → `REPLAY` → back to `RoleSelect`) and pointed out this contradicts both `onuw-web-spec.md` §5's explicit wording ("shown once, not every game once the group has already played") and its own "Rejouer vite" design goal (zero friction between rounds in the same room). Fixed by defaulting the checkbox to checked, so the default action (continue without touching it) is what satisfies the spec's stated default behavior, while unchecking remains available for a group that explicitly wants the reminder repeated. Recorded here for the same reason as the Task 2 note above.

## Final whole-branch review — findings and dispositions

The final review (most-capable-model, whole-branch diff `dc54fa4..079e186`) found 3 Critical and 6 Important issues beyond what the per-task loops caught, all on real production-readiness concerns for a deployment task. Dispositions, applied as one consolidated fix wave rather than per-finding:

- **Overruled, not fixed:** the review's Critical claim that the server needs an explicit Socket.io `path` option to match the client's `VITE_SOCKET_PATH=/api/socket-io/socket.io`. This exact pairing — client sets that path, server sets none — is Vercel's own live, dated (2026-07-06) official worked example for Socket.IO Functions, fetched and quoted verbatim when this plan was first written (see Task 8's "Verification of the Vercel API shape" note above). The review's reasoning assumed generic Express-style path-prefix forwarding without accounting for how Vercel's WebSocket Function routing actually dispatches requests, which cannot be confirmed either way without a live deploy. Overriding a vendor's own tested example on unconfirmed generic reasoning would risk breaking what documentedly works. Disposition: no code change; `docs/deployment.md` gets an explicit note to smoke-test the WS handshake on first real deploy and only add a server-side `path` override if that specific request genuinely fails.
- **Fixed:** `vercel.json` had no SPA fallback rewrite — a real, well-known gap for any `BrowserRouter` app deployed as static output (confirmed independently of the path question above: this is about ordinary page routes like `/room/:code`, not Socket.io traffic). Deep links (the QR-code join flow, mid-game refreshes) would 404. Added a rewrite that excludes `/api/*` so the Vercel Function keeps priority.
- **Fixed:** `useFullscreen.ts`'s `screen.orientation?.lock("portrait")` is a real JS footgun — optional-chaining the object access doesn't guard a missing *method* on a present object (Safari has `screen.orientation` without `.lock()`/`.unlock()`), so the call throws before `.catch()` can attach, and since it's inside a `useEffect` body with no error boundary, it can take down the rest of the effect (including the back-navigation block) on browsers without `.lock()`. Fixed by chaining `?.` onto the method call itself too (`screen.orientation?.lock?.(...)`, `?.unlock?.()`), plus a new test rendering with `screen.orientation = {}` (no `lock` method).
- **Fixed (scoped, not a full redesign):** the shared Redis client has no `.on("error", ...)` listener, which the review connected to both an intermittent `npm run test` flake (an unhandled `error` event on a duplicated adapter connection during teardown surfaces as a suite-level crash) and a real Upstash-connection-limit risk in production. Added the listener as the minimal, well-understood ioredis fix; broader per-test-file connection cleanup is out of scope for this pass unless the listener alone doesn't resolve the flake.
- **Fixed:** `vercel.json` had no `functions.maxDuration`, leaving the one number this whole Phase 7 architecture is built around (Vercel's ~5-minute Function duration cap) to an unstated platform default. Set explicitly.
- **Fixed:** `disconnectHandler.ts`'s `setGrace` did a non-atomic `getRoom`→merge→`saveRoom` on the same `night` field the tick runner's timers concurrently write, racing a real tick advance. Switched to the codebase's existing `withRoom` CAS helper (already used elsewhere for exactly this class of race), which is a same-shape, low-risk change.
- **Fixed:** the service worker's offline fallback (`cache.match(SHELL_FALLBACK_PATH)`) could never match anything, because nothing ever populated the cache under that literal key — requests are cached under whatever URL was actually requested (`/`, `/room/ABCDE`, …), never `/index.html`. Fixed by also caching successful navigation responses under `SHELL_FALLBACK_PATH`, so the offline fallback has something to find; added a test for the navigation-caching behavior.
- **Fixed (a real, plan-level Task 5 gap, not an implementer deviation):** the onboarding notice was gated on `currentTick`, the same signal that fires the instant the server arms tick 0's timer — so a first-time group necessarily reads the reminder *while* tick 0's fixed window is already counting down, risking missing their own tick 0 action. Decoupled the notice from `currentTick` entirely: it now shows as soon as a player who hasn't dismissed it for this room reaches `RoleSelect`, well before the host can start the game, rather than racing the first tick's clock.
- **Softened, not asserted as fact:** `docs/deployment.md` cited `npx plugins add vercel/vercel-plugin` as the WebSockets-beta enablement command. That string is not invented — it's Vercel's own docs page's `install_vercel_plugin` frontmatter field, fetched verbatim — but the review is right that it reads as an unverified, possibly internal-tooling artifact rather than a confirmed user-facing CLI command. Reworded to cite it as "what the docs currently reference" with an explicit instruction to confirm the live enablement flow in the Vercel dashboard at deploy time, rather than asserting it as the one correct command.
- **Deliberately not fixed in this pass:** the rate limiter's abuse ceiling (bypassable by reconnecting; mitigated by rooms' existing 4-hour TTL) and the remaining service-worker Minors (content-type-agnostic caching, fire-and-forget `cache.put`, caching non-`ok` responses) — all already correctly triaged as Minor by the per-task reviews and reconfirmed as Minor by the final review; no new information changes that.
