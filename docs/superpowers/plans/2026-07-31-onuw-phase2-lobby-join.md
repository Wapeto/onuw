# Phase 2 — Lobby / Join Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the room create/join flow end-to-end — host creates a room (short code + QR), players join by code, everyone sees a live roster — plus the three Redis/roster hardening items the Phase 1 final review flagged as blocking prerequisites for this phase, per `docs/superpowers/plans/2026-07-28-onuw-web-app.md` §Phase 2.

**Architecture:** Server gains a `withRoom` atomic read-modify-write wrapper (fixes the concurrent-join race), a `toPublicPlayers` roster serializer (never leaks `connected` during `NIGHT`), a room-code generator, and `roomEvents.ts` wiring `CREATE_ROOM`/`JOIN_ROOM`/reconnect/disconnect onto the existing `createApp()`. Client gets its first test infrastructure (Vitest + jsdom + React Testing Library), a `useRoomSocket` hook wrapping `socket.io-client` with `sessionStorage`-backed identity, and `Home`/`Lobby` pages wired with `react-router-dom`. Reconnection uses `socket.join(roomCode)` + `socket.join(playerId)` directly (no hand-rolled `playerId → socketId` table), composing natively with the Redis adapter from Phase 1.

**Tech Stack:** Node.js, TypeScript strict (NodeNext resolution, server), Zod (socket payload validation), `ioredis`, React 19 + Vite (client), `react-router-dom`, `socket.io-client`, `qrcode`, Vitest, `@testing-library/react` + jsdom (new for client).

## Global Constraints

- Server code uses `NodeNext` module resolution: every relative import between `.ts` files MUST include the `.js` extension (e.g. `from "./roomStore.js"`).
- All new server files import types from `@onuw/shared` using `import type { ... }` only — no runtime rebuild of `shared/dist` is needed for this phase (no new runtime values are consumed from `@onuw/shared`).
- `GameState` lives only in Redis, keyed by room code, accessed only through `server/src/rooms/roomStore.ts`. No in-memory `Map` of rooms.
- Socket payloads and handshake `auth` are untrusted client input — validate with Zod at the point they're received, never trust raw shape.
- All mutating functions return new objects (spread-based immutable updates), per this user's global coding-style.md. No in-place mutation anywhere, including array `.map`/`.filter` results.
- Tests that touch Redis require a local Redis reachable at `REDIS_URL` (default `redis://localhost:6379`), started via `docker-compose up -d`. Tests use logical DB 15 (`redis://localhost:6379/15`) so `flushdb` in test cleanup never touches a dev DB.
- Client tests never open a real socket or real browser APIs beyond jsdom — `socket.io-client` and `qrcode` are mocked at the module boundary in every client test.
- No `console.log` in source files.

**Decisions locked in during this plan:**
- **`withRoom` uses a per-call duplicated Redis connection**, not the shared singleton. `WATCH` is scoped to the connection that issued it — if two concurrent `withRoom` calls shared one connection, their watched-key sets would merge and one call's `MULTI`/`EXEC` would consume the other's watch, silently breaking the optimistic lock. `ioredis`'s `.duplicate()` (already used the same way for the Redis adapter's `subClient` in `server/src/redis/socketAdapter.ts`) gives each call its own connection.
- **`PublicPlayer` (the roster broadcast shape) always omits `originalRoleId`/`currentRoleId`** — role secrecy is structural, not a `NIGHT`-only special case, even though those fields are always `undefined` until Phase 3. It masks `connected` to `null` specifically when `state.phase === "NIGHT"`, matching `TICK_PAUSED`'s existing neutral-payload precedent from Phase 1.
- **Reconnection is `socket.join(roomCode)` + `socket.join(playerId)` from the start** — no `playerId → socketId` table is ever built, per the Phase 1 review's suggestion. A player's own per-player Socket.io room (`playerId`) lets the server target them later (e.g. Phase 4's `TICK_PAYLOAD`) regardless of which instance they're connected to.
- **`sessionStorage` keys are unscoped** (`onuw:roomCode` / `onuw:playerId`, not namespaced per room code) — this app's usage model is one active room per browser tab, matching the spec's singular "playerId en sessionStorage."
- **`JOIN_ROOM` only succeeds while `phase === "LOBBY"`** — joining an in-progress game has no defined semantics yet (no spectator/late-join design exists), so it's rejected with `ROOM_ERROR` rather than left undefined.
- **The "Lancer" (launch) button is deferred entirely to Phase 3.** The master plan describes it as "gated on a valid preset," but preset validation (`server/src/roles/presetValidation.ts`) doesn't exist until Phase 3. Inventing a substitute gate (e.g. a player-count minimum) would be a Phase 3 product decision made without Phase 3's actual rules. Phase 2's `Lobby.tsx` shows the roster and QR code only.
- **`disconnectHandler.ts` (Phase 1) stays unwired to the transport layer.** Its `pauseTick`/`resumeTick` machinery only matters once `NIGHT` is reachable, which requires Phase 3 (role select) and Phase 4 (night UI). The master plan's own Phase 4 file list already says this module gets "branché ici à l'UI" in Phase 4. Phase 2 instead wires a lightweight, `NIGHT`-agnostic presence tracker (`connected` true/false via `withRoom`) directly in `roomEvents.ts` — sufficient for `LOBBY`, and it composes correctly with `toPublicPlayers`'s masking if the room later reaches `NIGHT` without any changes needed here.

---

## Task 1: Shared event contracts and `PublicPlayer` type

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`

**Interfaces:**
- Produces: `PublicPlayer` interface; extended `ServerToClientEvents` (`ROOM_CREATED`, `ROOM_JOINED`, `PLAYER_LIST_UPDATE`, `ROOM_ERROR`); extended `ClientToServerEvents` (`CREATE_ROOM`, `JOIN_ROOM`).

- [ ] **Step 1: Write the failing test**

Append to `shared/src/types.test.ts`:

```typescript
import type { PublicPlayer, ServerToClientEvents, ClientToServerEvents } from "./types";

describe("lobby event contracts", () => {
  it("PublicPlayer never carries role fields, and allows a masked connected state", () => {
    const visible: PublicPlayer = { id: "p1", pseudo: "Alice", isHost: true, connected: true };
    const masked: PublicPlayer = { id: "p2", pseudo: "Bob", isHost: false, connected: null };

    expect(visible.connected).toBe(true);
    expect(masked.connected).toBeNull();
    // @ts-expect-error PublicPlayer must not expose role fields
    expect(visible.originalRoleId).toBeUndefined();
  });

  it("wires CREATE_ROOM/JOIN_ROOM and their server responses", () => {
    const clientEvents: ClientToServerEvents = {
      ping: () => {},
      CREATE_ROOM: (_payload: { pseudo: string }) => {},
      JOIN_ROOM: (_payload: { roomCode: string; pseudo: string }) => {},
    };
    const serverEvents: ServerToClientEvents = {
      connected: (_payload: { socketId: string }) => {},
      ROOM_CREATED: (_payload: { roomCode: string; playerId: string }) => {},
      ROOM_JOINED: (_payload: { roomCode: string; playerId: string }) => {},
      PLAYER_LIST_UPDATE: (_payload: { players: PublicPlayer[] }) => {},
      ROOM_ERROR: (_payload: { message: string }) => {},
    };

    expect(typeof clientEvents.CREATE_ROOM).toBe("function");
    expect(typeof serverEvents.PLAYER_LIST_UPDATE).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `PublicPlayer` not exported, `ClientToServerEvents`/`ServerToClientEvents` object literals missing required properties (TypeScript compile errors surfaced by Vitest's esbuild transform).

- [ ] **Step 3: Write minimal implementation**

In `shared/src/types.ts`, add `PublicPlayer` right after the `Player` interface:

```typescript
export interface PublicPlayer {
  id: string;
  pseudo: string;
  isHost: boolean;
  connected: boolean | null;
}
```

Replace the `ServerToClientEvents`/`ClientToServerEvents` block at the bottom of the file with:

```typescript
export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS.

- [ ] **Step 5: Rebuild shared and confirm server's existing tests still pass**

Run: `npm run build -w shared && npm run test -w server`
Expected: PASS — every server file only uses `import type` from `@onuw/shared`.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts
git commit -m "feat: add PublicPlayer type and lobby event contracts to shared types"
```

---

## Task 2: Atomic `withRoom` read-modify-write wrapper

**Files:**
- Modify: `server/src/rooms/roomStore.ts`
- Modify: `server/src/rooms/roomStore.test.ts`

**Interfaces:**
- Consumes: `getRedisClient()` from `../redis/client.js`; `GameState` from `@onuw/shared`.
- Produces: `withRoom(roomCode: string, mutate: (state: GameState) => GameState, maxAttempts?: number): Promise<GameState>`; `RoomNotFoundError` class — both consumed by `roomEvents.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `server/src/rooms/roomStore.test.ts` (add `withRoom` and `RoomNotFoundError` to the existing import line):

```typescript
import { createRoom, getRoom, saveRoom, deleteRoom, withRoom, RoomNotFoundError, ROOM_TTL_SECONDS } from "./roomStore.js";
```

```typescript
describe("withRoom", () => {
  it("applies a mutation and returns the updated state", async () => {
    const state = fixture("WITH");
    await createRoom(state);

    const updated = await withRoom("WITH", (room) => ({ ...room, phase: "ROLE_SELECT" }));

    expect(updated.phase).toBe("ROLE_SELECT");
    expect((await getRoom("WITH"))?.phase).toBe("ROLE_SELECT");
  });

  it("throws RoomNotFoundError for an unknown room code", async () => {
    await expect(withRoom("NOPE", (room) => room)).rejects.toThrow(RoomNotFoundError);
  });

  it("resolves concurrent mutations without losing any write", async () => {
    const state = fixture("CONC");
    await createRoom(state);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withRoom("CONC", (room) => ({
          ...room,
          players: [...room.players, { id: `p${i}`, pseudo: `P${i}`, isHost: false, connected: true }],
          updatedAt: Date.now(),
        })),
      ),
    );

    const loaded = await getRoom("CONC");
    expect(loaded?.players).toHaveLength(1 + 8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `withRoom is not a function`, `RoomNotFoundError` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `server/src/rooms/roomStore.ts`:

```typescript
export class RoomNotFoundError extends Error {
  constructor(roomCode: string) {
    super(`room ${roomCode} not found`);
    this.name = "RoomNotFoundError";
  }
}

export async function withRoom(
  roomCode: string,
  mutate: (state: GameState) => GameState,
  maxAttempts = 5,
): Promise<GameState> {
  const key = roomKey(roomCode);
  // WATCH is connection-scoped: a dedicated connection per call keeps concurrent
  // withRoom() invocations from merging watch state and silently breaking the CAS.
  const conn = getRedisClient().duplicate();
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await conn.watch(key);
      const raw = await conn.get(key);
      if (!raw) {
        await conn.unwatch();
        throw new RoomNotFoundError(roomCode);
      }
      const next = mutate(JSON.parse(raw) as GameState);
      const result = await conn.multi().set(key, JSON.stringify(next), "EX", ROOM_TTL_SECONDS).exec();
      if (result !== null) return next;
    }
    throw new Error(`withRoom: exceeded ${maxAttempts} attempts for room ${roomCode}`);
  } finally {
    await conn.quit();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roomStore.ts server/src/rooms/roomStore.test.ts
git commit -m "feat: add withRoom atomic read-modify-write wrapper to fix concurrent-join race"
```

---

## Task 3: Roster serialization that masks `connected` during NIGHT

**Files:**
- Create: `server/src/rooms/roomView.ts`
- Create: `server/src/rooms/roomView.test.ts`

**Interfaces:**
- Consumes: `GameState`, `PublicPlayer` from `@onuw/shared`.
- Produces: `toPublicPlayers(state: GameState): PublicPlayer[]` — consumed by `roomEvents.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { toPublicPlayers } from "./roomView.js";

function fixture(phase: GameState["phase"]): GameState {
  return {
    roomCode: "ABCD",
    phase,
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, originalRoleId: "seer", currentRoleId: "seer" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: false },
    ],
    center: [],
    night: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("toPublicPlayers", () => {
  it("passes through real connected state outside of NIGHT", () => {
    const players = toPublicPlayers(fixture("LOBBY"));
    expect(players).toEqual([
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: false },
    ]);
  });

  it("masks connected to null during NIGHT", () => {
    const players = toPublicPlayers(fixture("NIGHT"));
    expect(players.every((p) => p.connected === null)).toBe(true);
  });

  it("never includes role fields, in any phase", () => {
    const players = toPublicPlayers(fixture("NIGHT"));
    expect(players[0]).not.toHaveProperty("originalRoleId");
    expect(players[0]).not.toHaveProperty("currentRoleId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `./roomView.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { GameState, PublicPlayer } from "@onuw/shared";

export function toPublicPlayers(state: GameState): PublicPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    isHost: p.isHost,
    connected: state.phase === "NIGHT" ? null : p.connected,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roomView.ts server/src/rooms/roomView.test.ts
git commit -m "feat: mask connected status in roster broadcasts during NIGHT"
```

---

## Task 4: Room code generator

**Files:**
- Create: `server/src/rooms/roomCode.ts`
- Create: `server/src/rooms/roomCode.test.ts`
- Modify: `server/package.json` (add `nanoid` dependency)

**Interfaces:**
- Produces: `generateRoomCode(): string` — consumed by `roomEvents.ts` (Task 5).

- [ ] **Step 1: Add the dependency**

In `server/package.json`, add to `dependencies`:

```json
"nanoid": "^6.0.0",
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { generateRoomCode } from "./roomCode.js";

describe("generateRoomCode", () => {
  it("generates a 5-character code from the confusable-free alphabet", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it("generates different codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `./roomCode.js`.

- [ ] **Step 4: Write minimal implementation**

```typescript
import { customAlphabet } from "nanoid";

// Drops 0/O and 1/I — the two pairs players most often misread off a small screen.
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const nanoid = customAlphabet(ROOM_CODE_ALPHABET, 5);

export function generateRoomCode(): string {
  return nanoid();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json package-lock.json server/src/rooms/roomCode.ts server/src/rooms/roomCode.test.ts
git commit -m "feat: add short room-code generator with a confusable-free alphabet"
```

---

## Task 5: `roomEvents.ts` — CREATE_ROOM / JOIN_ROOM / reconnect / disconnect

**Files:**
- Create: `server/src/rooms/roomEvents.ts`
- Create: `server/src/rooms/roomEvents.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/package.json` (add `zod` dependency)

**Interfaces:**
- Consumes: `createRoom`, `getRoom`, `withRoom`, `RoomNotFoundError` from `./roomStore.js`; `toPublicPlayers` from `./roomView.js`; `generateRoomCode` from `./roomCode.js`.
- Produces: `registerRoomEvents(io: Server<ClientToServerEvents, ServerToClientEvents>, socket: Socket<ClientToServerEvents, ServerToClientEvents>): void` — consumed by `createApp()` in `index.ts`.

- [ ] **Step 1: Add the dependency**

In `server/package.json`, add to `dependencies`:

```json
"zod": "^4.4.0",
```

Run: `npm install`

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";

describe("room events", () => {
  let app: ReturnType<typeof createApp>;
  let port: number;
  const clients: Socket[] = [];

  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });

  beforeEach(async () => {
    app = createApp();
    port = await listen(app, 0);
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  function connect(auth: Record<string, unknown> = {}): Promise<Socket> {
    return new Promise((resolve) => {
      const client = ioClient(`http://localhost:${port}`, { auth });
      clients.push(client);
      client.on("connect", () => resolve(client));
    });
  }

  it("creates a room and returns a roomCode/playerId", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });
    expect(created.roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
    expect(created.playerId).toBeTruthy();
  });

  it("rejects CREATE_ROOM with a blank pseudo", async () => {
    const host = await connect();
    const err = await new Promise<{ message: string }>((resolve) => {
      host.on("ROOM_ERROR", resolve);
      host.emit("CREATE_ROOM", { pseudo: "   " });
    });
    expect(err.message).toMatch(/pseudo/);
  });

  it("broadcasts an updated roster when a second player joins", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const rosterAfterJoin = new Promise<{ players: { pseudo: string }[] }>((resolve) => {
      host.on("PLAYER_LIST_UPDATE", (payload) => {
        if (payload.players.length === 2) resolve(payload);
      });
    });

    const guest = await connect();
    guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });

    const roster = await rosterAfterJoin;
    expect(roster.players.map((p) => p.pseudo).sort()).toEqual(["Alice", "Bob"]);
  });

  it("rejects JOIN_ROOM for an unknown room code", async () => {
    const guest = await connect();
    const err = await new Promise<{ message: string }>((resolve) => {
      guest.on("ROOM_ERROR", resolve);
      guest.emit("JOIN_ROOM", { roomCode: "ZZZZZ", pseudo: "Bob" });
    });
    expect(err.message).toMatch(/not found/);
  });

  it("marks a player disconnected in the broadcast roster", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const guest = await connect();
    await new Promise<void>((resolve) => {
      guest.on("ROOM_JOINED", () => resolve());
      guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
    });

    const disconnectedRoster = new Promise<{ players: { pseudo: string; connected: boolean | null }[] }>((resolve) => {
      host.on("PLAYER_LIST_UPDATE", (payload) => {
        const bob = payload.players.find((p) => p.pseudo === "Bob");
        if (bob && bob.connected === false) resolve(payload);
      });
    });
    guest.close();
    const roster = await disconnectedRoster;
    expect(roster.players.find((p) => p.pseudo === "Bob")?.connected).toBe(false);
  });

  it("reattaches to an existing room via handshake auth", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const reattached = await connect({ roomCode: created.roomCode, playerId: created.playerId });
    const joined = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      reattached.on("ROOM_JOINED", resolve);
    });

    expect(joined).toEqual(created);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../rooms/roomEvents.js` is not yet imported anywhere, and no `CREATE_ROOM`/`JOIN_ROOM` handlers exist, so every promise above times out.

- [ ] **Step 4: Write minimal implementation**

Create `server/src/rooms/roomEvents.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { generateRoomCode } from "./roomCode.js";
import { createRoom, getRoom, withRoom, RoomNotFoundError } from "./roomStore.js";
import { toPublicPlayers } from "./roomView.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const MAX_ROOM_CODE_ATTEMPTS = 5;

const pseudoSchema = z.string().trim().min(1).max(24);
const createRoomPayloadSchema = z.object({ pseudo: pseudoSchema });
const joinRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(1).max(10),
  pseudo: pseudoSchema,
});
const handshakeAuthSchema = z.object({ roomCode: z.string().min(1), playerId: z.string().min(1) }).partial();

async function broadcastRoster(io: AppServer, state: GameState): Promise<void> {
  io.to(state.roomCode).emit("PLAYER_LIST_UPDATE", { players: toPublicPlayers(state) });
}

async function setConnected(roomCode: string, playerId: string, connected: boolean): Promise<GameState | null> {
  try {
    return await withRoom(roomCode, (room) => ({
      ...room,
      players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
      updatedAt: Date.now(),
    }));
  } catch (err) {
    if (err instanceof RoomNotFoundError) return null;
    throw err;
  }
}

export function registerRoomEvents(io: AppServer, socket: AppSocket): void {
  let membership: { roomCode: string; playerId: string } | null = null;

  const authResult = handshakeAuthSchema.safeParse(socket.handshake.auth);
  const auth = authResult.success ? authResult.data : {};
  if (auth.roomCode && auth.playerId) {
    const roomCode = auth.roomCode;
    const playerId = auth.playerId;
    void (async () => {
      const state = await setConnected(roomCode, playerId, true);
      if (!state) return;
      membership = { roomCode, playerId };
      await socket.join(roomCode);
      await socket.join(playerId);
      socket.emit("ROOM_JOINED", { roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  }

  socket.on("CREATE_ROOM", (payload) => {
    void (async () => {
      const parsed = createRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "pseudo is required" });
        return;
      }
      const playerId = randomUUID();
      const now = Date.now();
      let state: GameState | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
        const roomCode = generateRoomCode();
        const candidate: GameState = {
          roomCode,
          phase: "LOBBY",
          players: [{ id: playerId, pseudo: parsed.data.pseudo, isHost: true, connected: true }],
          center: [],
          night: null,
          createdAt: now,
          updatedAt: now,
        };
        if (await createRoom(candidate)) {
          state = candidate;
          break;
        }
      }
      if (!state) {
        socket.emit("ROOM_ERROR", { message: "failed to allocate a room code, try again" });
        return;
      }
      membership = { roomCode: state.roomCode, playerId };
      await socket.join(state.roomCode);
      await socket.join(playerId);
      socket.emit("ROOM_CREATED", { roomCode: state.roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  });

  socket.on("JOIN_ROOM", (payload) => {
    void (async () => {
      const parsed = joinRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "pseudo and room code are required" });
        return;
      }
      const { roomCode, pseudo } = parsed.data;
      const existing = await getRoom(roomCode);
      if (!existing) {
        socket.emit("ROOM_ERROR", { message: "room not found" });
        return;
      }
      if (existing.phase !== "LOBBY") {
        socket.emit("ROOM_ERROR", { message: "game already in progress" });
        return;
      }
      const playerId = randomUUID();
      const state = await withRoom(roomCode, (room) => ({
        ...room,
        players: [...room.players, { id: playerId, pseudo, isHost: false, connected: true }],
        updatedAt: Date.now(),
      }));
      membership = { roomCode: state.roomCode, playerId };
      await socket.join(state.roomCode);
      await socket.join(playerId);
      socket.emit("ROOM_JOINED", { roomCode: state.roomCode, playerId });
      await broadcastRoster(io, state);
    })();
  });

  socket.on("disconnect", () => {
    if (!membership) return;
    const { roomCode, playerId } = membership;
    void (async () => {
      const state = await setConnected(roomCode, playerId, false);
      if (state) await broadcastRoster(io, state);
    })();
  });
}
```

Modify `server/src/index.ts` — add the import and call `registerRoomEvents` inside the connection handler:

```typescript
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@onuw/shared";
import { attachRedisAdapter } from "./redis/socketAdapter.js";
import { registerRoomEvents } from "./rooms/roomEvents.js";

export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: "*" } },
  );
  const subClient = attachRedisAdapter(io);

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
    registerRoomEvents(io, socket);
  });

  return { httpServer, io, subClient };
}

export function listen(
  app: ReturnType<typeof createApp>,
  port: number,
): Promise<number> {
  return new Promise((resolve) => {
    app.httpServer.listen(port, () => {
      const address = app.httpServer.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      resolve(actualPort);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3001;
  listen(app, port).then((actualPort) => {
    console.log(`ONUW server listening on port ${actualPort}`);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — all 7 room-events tests plus every pre-existing server test.

- [ ] **Step 6: Commit**

```bash
git add server/package.json package-lock.json server/src/rooms/roomEvents.ts server/src/rooms/roomEvents.test.ts server/src/index.ts
git commit -m "feat: wire CREATE_ROOM/JOIN_ROOM and silent lobby reconnect into createApp"
```

---

## Task 6: Client test infrastructure (Vitest + jsdom + React Testing Library)

**Files:**
- Create: `client/vitest.config.ts`
- Create: `client/src/test/setup.ts`
- Create: `client/src/test/smoke.test.tsx`
- Modify: `client/package.json` (test script + new devDependencies)
- Modify: `package.json` (root `test` script)

**Interfaces:**
- Produces: a working `npm run test -w client`, extended by every later client task.

- [ ] **Step 1: Add dependencies**

In `client/package.json`, add to `devDependencies`:

```json
"@testing-library/jest-dom": "^7.0.0",
"@testing-library/react": "^16.3.2",
"jsdom": "^30.0.1",
"vitest": "^4.1.10",
```

Add to `scripts`:

```json
"test": "vitest run",
```

Run: `npm install`

- [ ] **Step 2: Write the config and setup files**

`client/vitest.config.ts`:

```typescript
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
```

`client/src/test/setup.ts`:

```typescript
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 3: Write the smoke test**

`client/src/test/smoke.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("client test infrastructure", () => {
  it("renders into jsdom and matches text content", () => {
    render(<div>ok</div>);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS (1 test).

- [ ] **Step 5: Wire the client into the root test script**

In root `package.json`, change:

```json
"test": "npm run test -w shared && npm run test -w server",
```

to:

```json
"test": "npm run test -w shared && npm run test -w server && npm run test -w client",
```

Run: `npm test`
Expected: PASS — shared, server, and client suites all run.

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/vitest.config.ts client/src/test/setup.ts client/src/test/smoke.test.tsx package.json package-lock.json
git commit -m "test: add Vitest/jsdom/React Testing Library infrastructure for the client"
```

---

## Task 7: `useRoomSocket` client hook

**Files:**
- Create: `client/src/hooks/useRoomSocket.ts`
- Create: `client/src/hooks/useRoomSocket.test.ts`
- Modify: `client/package.json` (add `socket.io-client` dependency)

**Interfaces:**
- Consumes: `PublicPlayer`, `ServerToClientEvents`, `ClientToServerEvents` from `@onuw/shared`.
- Produces: `useRoomSocket(): { roomCode: string; playerId: string; players: PublicPlayer[]; error: string | null; createRoom: (pseudo: string) => void; joinRoom: (roomCode: string, pseudo: string) => void }` — consumed by `Home.tsx` (Task 8) and `Lobby.tsx` (Task 10).

- [ ] **Step 1: Add the dependency**

In `client/package.json`, add to `dependencies`:

```json
"socket.io-client": "^4.8.0",
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRoomSocket } from "./useRoomSocket";

const mockSocket = vi.hoisted(() => {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  return {
    on(event: string, cb: (payload: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    },
    trigger(event: string, payload: unknown) {
      for (const cb of handlers.get(event) ?? []) cb(payload);
    },
    reset() {
      handlers.clear();
    },
    emit: vi.fn(),
    close: vi.fn(),
  };
});

vi.mock("socket.io-client", () => ({
  io: () => mockSocket,
}));

describe("useRoomSocket", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockSocket.reset();
    mockSocket.emit.mockClear();
  });

  it("stores roomCode/playerId in sessionStorage on ROOM_CREATED", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROOM_CREATED", { roomCode: "ABCDE", playerId: "p1" });
    });

    expect(result.current.roomCode).toBe("ABCDE");
    expect(result.current.playerId).toBe("p1");
    expect(sessionStorage.getItem("onuw:roomCode")).toBe("ABCDE");
    expect(sessionStorage.getItem("onuw:playerId")).toBe("p1");
  });

  it("updates players on PLAYER_LIST_UPDATE", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("PLAYER_LIST_UPDATE", {
        players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      });
    });

    expect(result.current.players).toHaveLength(1);
    expect(result.current.players[0].pseudo).toBe("Alice");
  });

  it("surfaces ROOM_ERROR messages", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROOM_ERROR", { message: "room not found" });
    });

    expect(result.current.error).toBe("room not found");
  });

  it("emits CREATE_ROOM with the given pseudo", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.createRoom("Alice");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("CREATE_ROOM", { pseudo: "Alice" });
  });

  it("emits JOIN_ROOM with the given code and pseudo", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.joinRoom("ABCDE", "Bob");
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("JOIN_ROOM", { roomCode: "ABCDE", pseudo: "Bob" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — cannot find module `./useRoomSocket`.

- [ ] **Step 4: Write minimal implementation**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PublicPlayer, ServerToClientEvents } from "@onuw/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const STORAGE_ROOM_CODE = "onuw:roomCode";
const STORAGE_PLAYER_ID = "onuw:playerId";

export interface RoomSession {
  roomCode: string;
  playerId: string;
  players: PublicPlayer[];
  error: string | null;
  createRoom: (pseudo: string) => void;
  joinRoom: (roomCode: string, pseudo: string) => void;
}

function readStoredSession(): { roomCode: string; playerId: string } {
  return {
    roomCode: sessionStorage.getItem(STORAGE_ROOM_CODE) ?? "",
    playerId: sessionStorage.getItem(STORAGE_PLAYER_ID) ?? "",
  };
}

function storeSession(roomCode: string, playerId: string): void {
  sessionStorage.setItem(STORAGE_ROOM_CODE, roomCode);
  sessionStorage.setItem(STORAGE_PLAYER_ID, playerId);
}

export function useRoomSocket(): RoomSession {
  const socketRef = useRef<AppSocket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredSession();
    const socket: AppSocket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: stored.roomCode && stored.playerId ? stored : {},
    });
    socketRef.current = socket;

    socket.on("ROOM_CREATED", (payload) => {
      storeSession(payload.roomCode, payload.playerId);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("ROOM_JOINED", (payload) => {
      storeSession(payload.roomCode, payload.playerId);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("PLAYER_LIST_UPDATE", (payload) => setPlayers(payload.players));
    socket.on("ROOM_ERROR", (payload) => setError(payload.message));

    return () => {
      socket.close();
    };
  }, []);

  const createRoom = useCallback((pseudo: string) => {
    socketRef.current?.emit("CREATE_ROOM", { pseudo });
  }, []);

  const joinRoom = useCallback((roomCode: string, pseudo: string) => {
    socketRef.current?.emit("JOIN_ROOM", { roomCode, pseudo });
  }, []);

  return { roomCode, playerId, players, error, createRoom, joinRoom };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/package.json package-lock.json client/src/hooks/useRoomSocket.ts client/src/hooks/useRoomSocket.test.ts
git commit -m "feat: add useRoomSocket hook wrapping socket.io-client with sessionStorage identity"
```

---

## Task 8: `Home.tsx` — create/join screen

**Files:**
- Create: `client/src/pages/Home.tsx`
- Create: `client/src/pages/Home.test.tsx`
- Modify: `client/package.json` (add `react-router-dom` dependency)

**Interfaces:**
- Consumes: `useRoomSocket` from `../hooks/useRoomSocket.js` (mocked in this task's test); `useNavigate`/`useParams` from `react-router-dom`.
- Produces: default-exported `Home` component, routed at `/` and `/join/:code` in Task 11.

- [ ] **Step 1: Add the dependency**

In `client/package.json`, add to `dependencies`:

```json
"react-router-dom": "^7.18.2",
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Home from "./Home";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession() {
  return {
    roomCode: "",
    playerId: "",
    players: [],
    error: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession());
  });

  it("disables both action buttons until a pseudo is entered", () => {
    renderAt("/");
    expect(screen.getByRole("button", { name: /créer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rejoindre/i })).toBeDisabled();
  });

  it("calls createRoom with the entered pseudo", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session);
    renderAt("/");

    fireEvent.change(screen.getByLabelText(/pseudo/i), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: /créer/i }));

    expect(session.createRoom).toHaveBeenCalledWith("Alice");
  });

  it("calls joinRoom with the entered pseudo and code", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session);
    renderAt("/");

    fireEvent.change(screen.getByLabelText(/pseudo/i), { target: { value: "Bob" } });
    fireEvent.change(screen.getByPlaceholderText(/code/i), { target: { value: "abcde" } });
    fireEvent.click(screen.getByRole("button", { name: /rejoindre/i }));

    expect(session.joinRoom).toHaveBeenCalledWith("ABCDE", "Bob");
  });

  it("prefills the join code from a /join/:code route", () => {
    renderAt("/join/wxyz1");
    expect(screen.getByPlaceholderText(/code/i)).toHaveValue("WXYZ1");
  });

  it("shows a ROOM_ERROR message when present", () => {
    vi.mocked(useRoomSocket).mockReturnValue({ ...baseSession(), error: "room not found" });
    renderAt("/");
    expect(screen.getByRole("alert")).toHaveTextContent("room not found");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — cannot find module `./Home`, and `react-router-dom` may still need installing.

- [ ] **Step 4: Write minimal implementation**

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Home() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { roomCode, error, createRoom, joinRoom } = useRoomSocket();
  const [pseudo, setPseudo] = useState("");
  const [joinCode, setJoinCode] = useState(code?.toUpperCase() ?? "");

  useEffect(() => {
    if (roomCode) navigate(`/room/${roomCode}`);
  }, [roomCode, navigate]);

  const trimmedPseudo = pseudo.trim();

  return (
    <div>
      <h1>One Night Ultimate Werewolf</h1>

      <label>
        Pseudo
        <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo" />
      </label>

      <button onClick={() => createRoom(trimmedPseudo)} disabled={trimmedPseudo.length === 0}>
        Créer une partie
      </button>

      <div>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Code de la room"
        />
        <button
          onClick={() => joinRoom(joinCode, trimmedPseudo)}
          disabled={trimmedPseudo.length === 0 || joinCode.trim().length === 0}
        >
          Rejoindre
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export default Home;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/package.json package-lock.json client/src/pages/Home.tsx client/src/pages/Home.test.tsx
git commit -m "feat: add Home page for creating and joining a room"
```

---

## Task 9: `RoomQrCode.tsx` — QR component

**Files:**
- Create: `client/src/components/RoomQrCode.tsx`
- Create: `client/src/components/RoomQrCode.test.tsx`
- Modify: `client/package.json` (add `qrcode` dependency + `@types/qrcode` devDependency)

**Interfaces:**
- Produces: default-exported `RoomQrCode({ roomCode: string })` component — consumed by `Lobby.tsx` (Task 10).

- [ ] **Step 1: Add the dependencies**

In `client/package.json`, add to `dependencies`:

```json
"qrcode": "^1.5.4",
```

and to `devDependencies`:

```json
"@types/qrcode": "^1.5.6",
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QRCode from "qrcode";
import RoomQrCode from "./RoomQrCode";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,ABC") },
}));

describe("RoomQrCode", () => {
  it("renders a QR image encoding the join URL for the room code", async () => {
    render(<RoomQrCode roomCode="ABCDE" />);

    const img = await screen.findByAltText(/ABCDE/);
    expect(img).toHaveAttribute("src", "data:image/png;base64,ABC");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(expect.stringContaining("/join/ABCDE"));
  });

  it("renders nothing for an empty room code", () => {
    const { container } = render(<RoomQrCode roomCode="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — cannot find module `./RoomQrCode`.

- [ ] **Step 4: Write minimal implementation**

```tsx
import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface RoomQrCodeProps {
  roomCode: string;
}

function RoomQrCode({ roomCode }: RoomQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    const joinUrl = `${window.location.origin}/join/${roomCode}`;
    QRCode.toDataURL(joinUrl).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt={`QR code pour rejoindre la room ${roomCode}`} />;
}

export default RoomQrCode;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/package.json package-lock.json client/src/components/RoomQrCode.tsx client/src/components/RoomQrCode.test.tsx
git commit -m "feat: add RoomQrCode component encoding a /join/:code URL"
```

---

## Task 10: `Lobby.tsx` — live roster page

**Files:**
- Create: `client/src/pages/Lobby.tsx`
- Create: `client/src/pages/Lobby.test.tsx`

**Interfaces:**
- Consumes: `useRoomSocket` (mocked in this task's test); `RoomQrCode` from `../components/RoomQrCode.js`; `useParams` from `react-router-dom`.
- Produces: default-exported `Lobby` component, routed at `/room/:roomCode` in Task 11.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Lobby from "./Lobby";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));
vi.mock("../components/RoomQrCode", () => ({
  default: ({ roomCode }: { roomCode: string }) => <div data-testid="qr">{roomCode}</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode" element={<Lobby />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Lobby", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "ABCDE",
      playerId: "p1",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      ],
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
    });
  });

  it("lists every player's pseudo", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("marks the host in the roster", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText(/Alice.*hôte/i)).toBeInTheDocument();
  });

  it("renders the QR code for the room code from the route", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByTestId("qr")).toHaveTextContent("ABCDE");
  });

  it("does not render a launch control (deferred to Phase 3)", () => {
    renderAt("/room/ABCDE");
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — cannot find module `./Lobby`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoomQrCode from "../components/RoomQrCode";

function Lobby() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const { players } = useRoomSocket();

  return (
    <div>
      <h1>Room {routeRoomCode}</h1>
      <RoomQrCode roomCode={routeRoomCode ?? ""} />
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            {p.pseudo}
            {p.isHost ? " (hôte)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Lobby;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Lobby.tsx client/src/pages/Lobby.test.tsx
git commit -m "feat: add Lobby page showing the live roster and QR code"
```

---

## Task 11: Route `App.tsx` and manual end-to-end check

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/App.test.tsx` (new)

**Interfaces:**
- Consumes: `Home` (Task 8), `Lobby` (Task 10).
- Produces: the routed application shell.

- [ ] **Step 1: Write the failing test**

`client/src/App.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { useRoomSocket } from "./hooks/useRoomSocket";

vi.mock("./hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

describe("App", () => {
  it("renders Home at the root route", () => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "",
      playerId: "",
      players: [],
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
    });
    render(<App />);
    expect(screen.getByRole("heading", { name: /one night ultimate werewolf/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — `App` still renders the placeholder `<div>ONUW</div>`, no heading exists.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Home />} />
        <Route path="/room/:roomCode" element={<Lobby />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS. Then run the full suite: `npm test`
Expected: PASS — shared, server, client all green.

- [ ] **Step 5: Manual end-to-end smoke check**

Run: `docker-compose up -d && npm run dev`

In two separate browser tabs pointed at the client dev URL:
1. Tab A: enter a pseudo, click "Créer une partie" — confirm it navigates to `/room/<CODE>` and shows a QR code and a one-player roster with "(hôte)".
2. Tab B: enter a different pseudo, paste the room code from Tab A, click "Rejoindre" — confirm Tab B lands on the same `/room/<CODE>` and both tabs' rosters update to show both players live.
3. Refresh Tab B — confirm it silently reattaches (roster still shows both players, no duplicate entry) via the `sessionStorage`-backed handshake auth.

If any step fails, stop and debug before proceeding — this is the first fully working vertical slice of the app.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: route Home and Lobby pages in App"
```

---

## Phase 2 close-out

After Task 11, run the whole-branch final review the same way Phase 1 closed out (per `docs/superpowers/plans/2026-07-28-onuw-web-app.md` and `.superpowers/sdd/progress.md`'s convention): diff the full range of Phase 2 commits, address Important-severity findings before calling Phase 2 done, and record any deferred items or Phase-3-blocking prerequisites in `.superpowers/sdd/progress.md` the same way Phase 1's review surfaced this phase's prerequisites.
