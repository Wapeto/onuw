# ONUW Phase 0 — Setup Projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a buildable, testable monorepo (`shared` / `server` / `client`) with shared TypeScript types, a bare Socket.io server, and a bare React PWA client — nothing game-related yet. Every later phase builds on this skeleton.

**Architecture:** npm workspaces monorepo. `shared` holds types/contracts consumed by both `server` and `client` so they can never silently diverge. `server` is a Node.js + Socket.io process. `client` is a Vite + React + TS SPA.

**Tech Stack:** Node.js, TypeScript (strict), npm workspaces, Socket.io + socket.io-client, Vite + React, Vitest, ESLint (flat config).

## Global Constraints

- TypeScript strict mode everywhere, no `any`, no implicit types (project-wide rule).
- No comments in code unless the WHY is non-obvious.
- Server is authoritative; nothing game-related lives here yet, but the event-contract types laid down now (`shared/src/types.ts`) are load-bearing for every later phase — get the shape right, don't just stub it.
- No DB — not relevant to this phase, but don't add one "just in case."

---

## Task 1: Git init + root workspace scaffolding

**Files:**
- Create: `/package.json`
- Create: `/tsconfig.base.json`
- Create: `/.gitignore`

**Interfaces:**
- Produces: an npm workspaces root declaring `shared`, `server`, `client` as workspaces. Later tasks create those directories; npm workspaces tolerates declaring a workspace path before it exists as long as it exists by the time `npm install` runs against it.

- [ ] **Step 1: Initialize git**

Run: `git init`
Expected: `Initialized empty Git repository in /home/wapeto/projects/onuw/.git/`

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.env
*.local
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Write root `package.json`**

```json
{
  "name": "onuw",
  "private": true,
  "type": "module",
  "workspaces": [
    "shared",
    "server",
    "client"
  ],
  "scripts": {
    "test": "npm run test -w shared && npm run test -w server",
    "lint": "eslint .",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w client"
  }
}
```

- [ ] **Step 5: Verify npm recognizes the workspace root**

Run: `npm install`
Expected: completes without error (no workspace folders exist yet, npm just installs root-level deps — there are none yet, so this creates `package-lock.json` with an empty tree).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json .gitignore package-lock.json
git commit -m "chore: init repo and npm workspaces root"
```

---

## Task 2: Shared types package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/types.ts`
- Create: `shared/src/types.test.ts`
- Test: `shared/src/types.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1).
- Produces (consumed by every later task/phase):
  - `RoleId` (union type), `ROLE_IDS: readonly RoleId[]`, `isValidRoleId(value: string): value is RoleId`
  - `RoomPhase` union: `"LOBBY" | "ROLE_SELECT" | "NIGHT" | "DAY" | "VOTE" | "REVEAL"`
  - `Player` interface: `{ id: string; pseudo: string; isHost: boolean }`
  - `GameState` interface: `{ roomCode: string; phase: RoomPhase; players: Player[] }`
  - `ServerToClientEvents` / `ClientToServerEvents` interfaces (Socket.io typed events), extended in later phases — Task 3 needs `ServerToClientEvents.connected` and `ClientToServerEvents.ping` to exist.

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@onuw/shared",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "main": "src/types.ts",
  "types": "src/types.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies for this workspace**

Run: `npm install -D typescript vitest -w shared`
Expected: completes without error, adds `typescript` and `vitest` under `shared`'s `devDependencies`.

- [ ] **Step 4: Write the failing test**

```ts
// shared/src/types.test.ts
import { describe, it, expect } from "vitest";
import { ROLE_IDS, isValidRoleId } from "./types";

describe("isValidRoleId", () => {
  it("accepts every id in ROLE_IDS", () => {
    for (const id of ROLE_IDS) {
      expect(isValidRoleId(id)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isValidRoleId("wizard")).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `Cannot find module './types'` (the file doesn't exist yet).

- [ ] **Step 6: Write `shared/src/types.ts`**

```ts
export type RoleId =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "villager"
  | "hunter"
  | "tanner"
  | "villageIdiot";

export const ROLE_IDS: readonly RoleId[] = [
  "doppelganger",
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "villager",
  "hunter",
  "tanner",
  "villageIdiot",
];

export function isValidRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}

export type RoomPhase =
  | "LOBBY"
  | "ROLE_SELECT"
  | "NIGHT"
  | "DAY"
  | "VOTE"
  | "REVEAL";

export interface Player {
  id: string;
  pseudo: string;
  isHost: boolean;
}

export interface GameState {
  roomCode: string;
  phase: RoomPhase;
  players: Player[];
}

export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS — 2 tests passed.

- [ ] **Step 8: Commit**

```bash
git add shared/
git commit -m "feat: add shared role/game-state types and role-id validation"
```

---

## Task 3: Server bootstrap (Socket.io)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`
- Test: `server/src/index.test.ts`

**Interfaces:**
- Consumes: `@onuw/shared` (`ServerToClientEvents`, `ClientToServerEvents` from Task 2).
- Produces: `createApp(): { httpServer: http.Server; io: Server }` and `listen(app, port): Promise<number>`, used by every later server-side test as the way to spin up an ephemeral test server.

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@onuw/server",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@onuw/shared": "*",
    "socket.io": "^4.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "socket.io-client": "^4.8.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes without error, resolves `@onuw/shared` to the local workspace package via a symlink in `node_modules/@onuw/shared`.

- [ ] **Step 4: Write the failing test**

```ts
// server/src/index.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "./index";

describe("server bootstrap", () => {
  let app: ReturnType<typeof createApp>;
  let client: Socket;

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
  });

  it("emits a connected event carrying the socket id", async () => {
    app = createApp();
    const port = await listen(app, 0);
    client = ioClient(`http://localhost:${port}`);

    const payload = await new Promise<{ socketId: string }>((resolve) => {
      client.on("connected", resolve);
    });

    expect(payload.socketId).toBe(client.id);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `Cannot find module './index'` (the file doesn't exist yet).

- [ ] **Step 6: Write `server/src/index.ts`**

```ts
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@onuw/shared";

export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: "*" } },
  );

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
  });

  return { httpServer, io };
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

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 1 test passed.

- [ ] **Step 8: Manual smoke check of the dev script**

Run: `PORT=3001 npm run dev -w server` (in one terminal, then Ctrl+C after confirming)
Expected: prints `ONUW server listening on port 3001` and stays running.

- [ ] **Step 9: Commit**

```bash
git add server/
git commit -m "feat: bootstrap Socket.io server with connected-event handshake"
```

---

## Task 4: Client scaffold (Vite + React + TS)

**Files:**
- Create: `client/` (generated by Vite scaffold, then trimmed)
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: nothing yet from `shared`/`server` — this task only proves the client builds and runs. Phase 2 (Lobby) is the first task that imports `@onuw/shared` from the client.

- [ ] **Step 1: Scaffold the client with Vite's React-TS template**

Run: `npm create vite@latest client -- --template react-ts`
Expected: creates `client/` with the standard Vite React+TS template files.

- [ ] **Step 2: Point the client's tsconfig at the shared base config**

Edit `client/tsconfig.app.json`, add `"extends": "../tsconfig.base.json"` to `compilerOptions` inheritance (Vite's generated file already has its own `compilerOptions`; keep Vite's bundler-specific settings — `jsx`, `lib`, `types` — and layer the shared `strict`/`target` conventions on top so the client doesn't drift from `server`/`shared` on strictness).

- [ ] **Step 3: Replace the default demo content in `client/src/App.tsx`**

```tsx
function App() {
  return <div>ONUW</div>;
}

export default App;
```

- [ ] **Step 4: Install workspace dependencies from the repo root**

Run: `npm install`
Expected: completes without error; `client` is now recognized as an npm workspace alongside `shared` and `server`.

- [ ] **Step 5: Verify the client builds**

Run: `npm run build -w client`
Expected: completes without error, produces `client/dist/`.

- [ ] **Step 6: Verify the dev server boots**

Run: `npm run dev -w client` (then Ctrl+C after confirming)
Expected: prints a local URL (e.g. `http://localhost:5173/`) and serves the page showing `ONUW`.

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "feat: scaffold Vite React TS client"
```

---

## Task 5: Wire root dev/build/lint/test scripts + ESLint

**Files:**
- Create: `eslint.config.js`
- Modify: `/package.json`

**Interfaces:**
- Consumes: all three workspaces (Tasks 2-4) must exist for these scripts to have something to run against.
- Produces: `npm run dev` / `npm run build` / `npm run lint` / `npm run test` at the repo root — the commands every later phase's plan will reference for verification.

- [ ] **Step 1: Install root tooling**

Run: `npm install -D eslint typescript-eslint concurrently`
Expected: completes without error, adds these to the root `package.json` `devDependencies`.

- [ ] **Step 2: Write `eslint.config.js`**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 3: Add the `dev` script to root `package.json`**

Edit the `scripts` block to:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm run test -w shared && npm run test -w server",
    "lint": "eslint .",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w client"
  }
}
```

- [ ] **Step 4: Verify lint passes clean**

Run: `npm run lint`
Expected: exits 0, no errors (the codebase so far is only the minimal files written in Tasks 1-4).

- [ ] **Step 5: Verify the full test suite passes from the root**

Run: `npm run test`
Expected: PASS — 3 tests total (2 from `shared`, 1 from `server`).

- [ ] **Step 6: Verify the full build succeeds from the root**

Run: `npm run build`
Expected: completes without error — `shared/dist`, `server/dist`, and `client/dist` all produced.

- [ ] **Step 7: Verify `npm run dev` boots both processes**

Run: `npm run dev` (then Ctrl+C after confirming both lines appear)
Expected: both `ONUW server listening on port 3001` and the Vite client URL appear in the interleaved output.

- [ ] **Step 8: Commit**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "chore: wire root dev/build/lint/test scripts and ESLint"
```

---

## Self-Review

**Spec coverage:** Phase 0's own scope in the parent plan (`2026-07-28-onuw-web-app.md`) is "monorepo scaffoldé et buildable, types partagés en place, aucun jeu encore." Covered: workspaces root (Task 1), shared types incl. the `RoleId`/event-contract shapes every later phase depends on (Task 2), server boot (Task 3), client boot (Task 4), unified scripts (Task 5). No game logic is implemented here by design — that starts in the Phase 1 plan.

**Placeholder scan:** no `TODO`/`TBD`/"add error handling" language; every step shows real, complete code or an exact command with expected output.

**Type consistency:** `ServerToClientEvents.connected` (Task 2) matches the `socket.emit("connected", { socketId })` call and the test's `payload.socketId` (Task 3). `createApp`/`listen` signatures are identical between their definition (Task 3, Step 6) and their only consumer so far (Task 3, Step 4's test) — no other task references them yet, so no drift to check.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-28-onuw-phase0-setup.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
