# ONUW Phase 6 — Reveal & Rejouer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the win conditions once the vote resolves, reveal every player's final role and the winning team to the whole table, and let the host relaunch the same room straight into role configuration via a "Rejouer" button — without creating a new room or making anyone rejoin.

**Architecture:** Win-condition computation is a pure function (`server/src/state/winConditions.ts`, mirrors the existing `voteResolver.ts` placement) invoked exactly once, inside the same `withRoom` transaction that already resolves the vote (`voteEvents.ts`) — no separate REVEAL-computation step, no client-side rule logic. The result (`eliminated`/`winningTeam`/`winners`) is persisted on `GameState.reveal` so a reconnecting client gets it back via the same silent-catch-up mechanism already used for `DAY_START`/`VOTE_START` (`roomEvents.ts`), and broadcast live as `REVEAL_RESULT` (which also carries each player's `originalRoleId`/`currentRoleId`, read straight off `GameState.players` — no duplicate role storage). "Rejouer" is a new host-only `REPLAY` event that repurposes the already-declared-but-unused `REVEAL -> LOBBY` transition into `REVEAL -> ROLE_SELECT` (going through `LOBBY` would just add a screen the spec doesn't ask for), restores the last-used role selection so the host can keep or edit it, and clears every player's role assignment. Client-side, both new navigations reuse the existing "socket event flips a piece of `useRoomSocket` state → the *previous* page's `useEffect` notices and navigates forward" chain already used for Lobby→RoleSelect→Night→Day→Vote: `Vote.tsx` navigates to `/reveal` when `revealResult` appears, and `Reveal.tsx` navigates to `/roles` when `roleSelection` reappears (the same signal `RoleSelect.tsx` already treats as "config is ready", now re-armed by `REPLAY` instead of by `START_ROLE_SELECT`).

**Tech Stack:** TypeScript strict, Socket.io, Redis (ioredis) via the existing `roomStore.ts`/`withRoom` helpers, Zod for payload validation (none needed here — `REPLAY` takes no payload), Vitest + Testing Library, React Router.

## Global Constraints

- **Official win conditions** (matches the master phase plan's "Village/Loups/Tanner/Hunter, cas Minion sans Loup, kill en chaîne du Hunter"): the Village team wins if at least one Werewolf is eliminated; otherwise the Werewolf team (Werewolf + Minion) wins — this includes games with **zero Werewolves in play**, where only the Minion(s) win; the Tanner wins **alone** (only the Tanner(s) actually eliminated, nobody else) if the Tanner is eliminated, and this takes precedence even if a Werewolf was also eliminated the same round; the Hunter's vote target is eliminated immediately if the Hunter is eliminated (by the vote or by another Hunter's shot — resolved as a fixed-point chain so multi-Hunter custom games are handled correctly, not just a single hop).
- **Team assignment is by `currentRoleId`, not `originalRoleId`** — a Doppelganger/Robber/Troublemaker who ended the night as a Werewolf is on the Werewolf team at reveal time, exactly as `actionResolvers.ts` already tracks via `currentRoleId`.
- **Server is authoritative and computes once**: the client never derives `winningTeam` itself, it only renders the payload it's given.
- **No partial leaks**: exactly like the vote tally, nothing about roles or the winning team is ever sent before every player has voted and the transaction resolves.
- **"Rejouer" keeps the room and the players** — no new room code, no rejoin flow. It resets `night`/`day`/`vote`/`reveal` and every player's `originalRoleId`/`currentRoleId` to unset, and restores the room to `ROLE_SELECT` with the previous `roleSelection` pre-filled so the host can hit "Lancer" unchanged or tweak it first (`RoleSelect.tsx` already renders correctly off a pre-filled `roleSelection` — no changes needed there).
- **Out of scope, deliberately**: no scoreboard/match-history across replays, no rate limiting (already flagged as a pre-deployment Phase 7 item in the master plan), no change to `Lobby.tsx`. Also **not fixed here**: the known Phase 5 limitation where a player who disconnects during VOTE and never reconnects prevents the vote from ever resolving (`Object.keys(votes).length` never reaches `players.length`) — no spec requirement forces a fix, and this plan doesn't invent one; flagging again here per this project's "note deferred items, don't silently scope-creep" convention.
- TypeScript note (same as Phase 5): `server/tsconfig.json`/`shared/tsconfig.json` exclude `src/**/*.test.ts`, so server/shared test fixtures are **not** type-checked by the build — existing fixtures like `phases.test.ts`'s `base` object are already missing several `GameState` fields and that's fine. `client/tsconfig.app.json` has no such exclusion — client test fixtures **are** type-checked, so every client-side `RoomSession`/`useRoomSocket` mock this plan's tasks touch must be updated with the new fields.

---

## Task 1: Shared reveal/replay contracts (`shared/src/types.ts`)

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`
- Modify: `server/src/rooms/roomEvents.ts` (the `CREATE_ROOM` handler's initial `GameState` literal — the one production fixture that must reflect the two new required `GameState` fields immediately, same reasoning Phase 5 Task 1 used for `dayDurationMs`)

**Interfaces:**
- Produces: `WinningTeam` (`"village" | "werewolf" | "tanner"`), `RevealState { eliminated: string[]; winningTeam: WinningTeam; winners: string[] }`, `RevealPlayer { id: string; pseudo: string; originalRoleId: RoleId; currentRoleId: RoleId }`, `RevealPayload extends RevealState { players: RevealPlayer[] }`, `GameState.reveal: RevealState | null`, `GameState.lastRoleSelection: RoleSelection | null`, and 2 new events: `ServerToClientEvents.REVEAL_RESULT`, `ClientToServerEvents.REPLAY`.

- [ ] **Step 1: Write the failing test**

Add to `shared/src/types.test.ts`, right after the existing `describe("day/vote event contracts", ...)` block:

```typescript
describe("reveal/replay event contracts", () => {
  it("GameState carries a nullable reveal result and a nullable last role selection", () => {
    const state: GameState = {
      roomCode: "ABCD",
      phase: "REVEAL",
      players: [],
      center: [],
      night: null,
      day: null,
      vote: null,
      reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2", "p3"] },
      lastRoleSelection: { mode: "classic", roles: { werewolf: 2, villager: 1 } },
      roleSelection: null,
      dayDurationMs: DEFAULT_DAY_DURATION_MS,
      createdAt: 0,
      updatedAt: 0,
    };

    expect(state.reveal?.winningTeam).toBe("village");
    expect(state.lastRoleSelection?.mode).toBe("classic");
  });

  it("wires REVEAL_RESULT/REPLAY", () => {
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
      REVEAL_RESULT: () => {},
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
      REPLAY: () => {},
    };

    serverEvents.REVEAL_RESULT({
      eliminated: ["p1"],
      winningTeam: "werewolf",
      winners: ["w1"],
      players: [{ id: "p1", pseudo: "Alice", originalRoleId: "villager", currentRoleId: "villager" }],
    });
    expect(typeof clientEvents.REPLAY).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `GameState` missing `reveal`/`lastRoleSelection`, `ServerToClientEvents`/`ClientToServerEvents` missing `REVEAL_RESULT`/`REPLAY`.

- [ ] **Step 3: Write minimal implementation**

In `shared/src/types.ts`, add right after `VoteState`:

```typescript
export type WinningTeam = "village" | "werewolf" | "tanner";

export interface RevealState {
  eliminated: string[];
  winningTeam: WinningTeam;
  winners: string[];
}

export interface RevealPlayer {
  id: string;
  pseudo: string;
  originalRoleId: RoleId;
  currentRoleId: RoleId;
}

export interface RevealPayload extends RevealState {
  players: RevealPlayer[];
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
  reveal: RevealState | null;
  roleSelection: RoleSelection | null;
  lastRoleSelection: RoleSelection | null;
  dayDurationMs: number;
  createdAt: number;
  updatedAt: number;
}
```

Extend `ServerToClientEvents` (add after `VOTE_RESULT`):

```typescript
  VOTE_RESULT: (payload: { tally: Record<string, number>; eliminated: string[] }) => void;
  REVEAL_RESULT: (payload: RevealPayload) => void;
```

Extend `ClientToServerEvents` (add after `SUBMIT_VOTE`):

```typescript
  SUBMIT_VOTE: (payload: { targetPlayerId: string }) => void;
  REPLAY: () => void;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS

- [ ] **Step 5: Update the `CREATE_ROOM` fixture**

In `server/src/rooms/roomEvents.ts`, the `candidate: GameState` literal inside the `CREATE_ROOM` handler currently ends with `roleSelection: null,`. Add the two new required fields right after it:

```typescript
            roleSelection: null,
            lastRoleSelection: null,
```

and after `vote: null,` add:

```typescript
            vote: null,
            reveal: null,
```

- [ ] **Step 6: Run the shared and server suites**

Run: `npm run test -w shared && npm run test -w server`
Expected: PASS (server suite unaffected — `reveal`/`lastRoleSelection` are additive optional-at-runtime fields not yet read anywhere else).

- [ ] **Step 7: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: add reveal/replay contracts to shared GameState and socket events"
```

---

## Task 2: Stash the last role selection when a game starts (`server/src/roles/presetValidation.ts`)

**Files:**
- Modify: `server/src/roles/presetValidation.ts`
- Modify: `server/src/roles/presetValidation.test.ts`

**Interfaces:**
- Consumes: `GameState.lastRoleSelection` (Task 1)
- Produces: `assignRoles` now also sets `lastRoleSelection` on its returned `GameState`, so `REPLAY` (Task 9) has something to restore from.

- [ ] **Step 1: Write the failing test**

Add to `server/src/roles/presetValidation.test.ts`, inside the existing `describe("assignRoles", ...)` block:

```typescript
  it("stashes the role selection used for this game as lastRoleSelection, for a future Rejouer", () => {
    const roleSelection = {
      mode: "classic" as const,
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
    };
    const state = baseState({ roleSelection });

    const result = assignRoles(state, () => 0);

    expect(result.roleSelection).toBeNull();
    expect(result.lastRoleSelection).toEqual(roleSelection);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- presetValidation.test`
Expected: FAIL — `result.lastRoleSelection` is `undefined`, not the stashed selection.

- [ ] **Step 3: Write minimal implementation**

In `server/src/roles/presetValidation.ts`, the final `return` of `assignRoles` currently reads:

```typescript
  return { ...gameState, players, center: dealtToCenter, roleSelection: null, updatedAt: Date.now() };
```

Change it to:

```typescript
  return {
    ...gameState,
    players,
    center: dealtToCenter,
    roleSelection: null,
    lastRoleSelection: gameState.roleSelection,
    updatedAt: Date.now(),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- presetValidation.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/presetValidation.ts server/src/roles/presetValidation.test.ts
git commit -m "feat: stash the role selection used to start a game as lastRoleSelection"
```

---

## Task 3: `requireOriginalRole` helper (`server/src/roles/helpers.ts`)

**Files:**
- Modify: `server/src/roles/helpers.ts`
- Modify: `server/src/roles/helpers.test.ts` (create if it doesn't already exist — check first with `test -f server/src/roles/helpers.test.ts`)

**Interfaces:**
- Consumes: `Player` (shared)
- Produces: `requireOriginalRole(player: Player): RoleId` — mirrors the existing `requireCurrentRole`, throws if `originalRoleId` is unset. Used by Task 4's `toRevealPlayers`.

- [ ] **Step 1: Write the failing test**

If `server/src/roles/helpers.test.ts` doesn't exist yet, create it with:

```typescript
import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { requireOriginalRole } from "./helpers.js";

function player(overrides: Partial<GameState["players"][number]> = {}): GameState["players"][number] {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, reconnectToken: "t1", ...overrides };
}

describe("requireOriginalRole", () => {
  it("returns the player's originalRoleId when set", () => {
    expect(requireOriginalRole(player({ originalRoleId: "seer" }))).toBe("seer");
  });

  it("throws when originalRoleId is unset", () => {
    expect(() => requireOriginalRole(player())).toThrow(/no assigned role/);
  });
});
```

If the file already exists, add this `describe` block to it instead of replacing the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- helpers.test`
Expected: FAIL — `requireOriginalRole is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/roles/helpers.ts`, add right after `requireCurrentRole`:

```typescript
export function requireOriginalRole(player: Player): RoleId {
  if (player.originalRoleId === undefined) {
    throw new Error(`player ${player.id} has no assigned role`);
  }
  return player.originalRoleId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- helpers.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/helpers.ts server/src/roles/helpers.test.ts
git commit -m "feat: add requireOriginalRole helper alongside requireCurrentRole"
```

---

## Task 4: `toRevealPlayers` (`server/src/rooms/roomView.ts`)

**Files:**
- Modify: `server/src/rooms/roomView.ts`
- Modify: `server/src/rooms/roomView.test.ts`

**Interfaces:**
- Consumes: `requireCurrentRole`, `requireOriginalRole` (Task 3)
- Produces: `toRevealPlayers(state: GameState): RevealPlayer[]` — used by Task 7 (live broadcast) and Task 8 (reconnect catch-up) so the role-reveal mapping is written exactly once.

- [ ] **Step 1: Write the failing test**

Add to `server/src/rooms/roomView.test.ts`:

```typescript
import { toPublicPlayers, toRevealPlayers } from "./roomView.js";

// ...(existing toPublicPlayers describe block stays as-is)

describe("toRevealPlayers", () => {
  it("maps each player to their pseudo, original role, and final role", () => {
    const state = fixture("REVEAL");
    const revealPlayers = toRevealPlayers({
      ...state,
      players: [
        { ...state.players[0], originalRoleId: "seer", currentRoleId: "robber" },
        { ...state.players[1], originalRoleId: "villager", currentRoleId: "villager" },
      ],
    });

    expect(revealPlayers).toEqual([
      { id: "p1", pseudo: "Alice", originalRoleId: "seer", currentRoleId: "robber" },
      { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- roomView.test`
Expected: FAIL — `toRevealPlayers is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/rooms/roomView.ts`, change the import line and add the new function:

```typescript
import type { GameState, PublicPlayer, RevealPlayer } from "@onuw/shared";
import { requireCurrentRole, requireOriginalRole } from "../roles/helpers.js";

export function toPublicPlayers(state: GameState): PublicPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    isHost: p.isHost,
    connected: state.phase === "NIGHT" ? null : p.connected,
  }));
}

export function toRevealPlayers(state: GameState): RevealPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    originalRoleId: requireOriginalRole(p),
    currentRoleId: requireCurrentRole(p),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- roomView.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roomView.ts server/src/rooms/roomView.test.ts
git commit -m "feat: add toRevealPlayers for mapping GameState.players to their reveal roles"
```

---

## Task 5: Win-condition computation (`server/src/state/winConditions.ts`)

**Files:**
- Create: `server/src/state/winConditions.ts`
- Create: `server/src/state/winConditions.test.ts`

**Interfaces:**
- Consumes: `requireCurrentRole` (Task 3), `Player`/`RoleId`/`WinningTeam`/`RevealState` (shared)
- Produces: `roleTeam(roleId: RoleId): WinningTeam`, `computeWinConditions(players: Player[], votes: Record<string, string>, votedEliminated: string[]): RevealState` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `server/src/state/winConditions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { roleTeam, computeWinConditions } from "./winConditions.js";

type TestPlayer = GameState["players"][number];

function player(overrides: Partial<TestPlayer> = {}): TestPlayer {
  return { id: "p1", pseudo: "Alice", isHost: false, connected: true, reconnectToken: "t1", ...overrides };
}

describe("roleTeam", () => {
  it("groups werewolf and minion into the werewolf team", () => {
    expect(roleTeam("werewolf")).toBe("werewolf");
    expect(roleTeam("minion")).toBe("werewolf");
  });

  it("puts tanner on their own team", () => {
    expect(roleTeam("tanner")).toBe("tanner");
  });

  it("defaults every other role to the village team", () => {
    expect(roleTeam("villager")).toBe("village");
    expect(roleTeam("hunter")).toBe("village");
    expect(roleTeam("seer")).toBe("village");
  });
});

describe("computeWinConditions", () => {
  it("Village wins when a Werewolf is eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "s1", currentRoleId: "seer" }),
    ];
    const result = computeWinConditions(players, {}, ["w1"]);

    expect(result.winningTeam).toBe("village");
    expect(result.winners.sort()).toEqual(["s1", "v1"]);
    expect(result.eliminated).toEqual(["w1"]);
  });

  it("Werewolf team wins when no Werewolf is eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "m1", currentRoleId: "minion" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners.sort()).toEqual(["m1", "w1"]);
  });

  it("only the Minion wins when there are zero Werewolves in the game", () => {
    const players = [
      player({ id: "m1", currentRoleId: "minion" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual(["m1"]);
  });

  it("with no Minion and no Werewolf in the game, the werewolf team has no winners", () => {
    const players = [
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual([]);
  });

  it("the Tanner wins alone if eliminated, even when a Werewolf is also eliminated", () => {
    const players = [
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "t1", currentRoleId: "tanner" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["w1", "t1"]);

    expect(result.winningTeam).toBe("tanner");
    expect(result.winners).toEqual(["t1"]);
  });

  it("a Tanner who is not eliminated never wins, even if the Tanner team would otherwise win", () => {
    const players = [
      player({ id: "t1", currentRoleId: "tanner" }),
      player({ id: "v1", currentRoleId: "villager" }),
      player({ id: "v2", currentRoleId: "villager" }),
    ];
    const result = computeWinConditions(players, {}, ["v1"]);

    expect(result.winningTeam).toBe("werewolf");
    expect(result.winners).toEqual([]);
  });

  it("chains a Hunter's death into their vote target's elimination", () => {
    const players = [
      player({ id: "h1", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
      player({ id: "v1", currentRoleId: "villager" }),
    ];
    const votes = { h1: "w1", v1: "h1", w1: "h1" };
    const result = computeWinConditions(players, votes, ["h1"]);

    expect(result.eliminated.sort()).toEqual(["h1", "w1"]);
    expect(result.winningTeam).toBe("village");
  });

  it("does not add a target twice if the Hunter's target is already eliminated", () => {
    const players = [
      player({ id: "h1", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
    ];
    const votes = { h1: "w1" };
    const result = computeWinConditions(players, votes, ["h1", "w1"]);

    expect(result.eliminated.sort()).toEqual(["h1", "w1"]);
  });

  it("chains through two Hunters (Hunter A's shot kills Hunter B, whose shot then fires too)", () => {
    const players = [
      player({ id: "ha", currentRoleId: "hunter" }),
      player({ id: "hb", currentRoleId: "hunter" }),
      player({ id: "w1", currentRoleId: "werewolf" }),
    ];
    const votes = { ha: "hb", hb: "w1" };
    const result = computeWinConditions(players, votes, ["ha"]);

    expect(result.eliminated.sort()).toEqual(["ha", "hb", "w1"]);
    expect(result.winningTeam).toBe("village");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- winConditions.test`
Expected: FAIL — `Cannot find module './winConditions.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/state/winConditions.ts`:

```typescript
import type { Player, RevealState, RoleId, WinningTeam } from "@onuw/shared";
import { requireCurrentRole } from "../roles/helpers.js";

export function roleTeam(roleId: RoleId): WinningTeam {
  if (roleId === "werewolf" || roleId === "minion") return "werewolf";
  if (roleId === "tanner") return "tanner";
  return "village";
}

function chainHunterKills(
  roleOf: Map<string, RoleId>,
  votes: Record<string, string>,
  eliminated: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...eliminated]) {
      if (roleOf.get(id) !== "hunter") continue;
      const target = votes[id];
      if (target && !eliminated.has(target)) {
        eliminated.add(target);
        changed = true;
      }
    }
  }
}

export function computeWinConditions(
  players: Player[],
  votes: Record<string, string>,
  votedEliminated: string[],
): RevealState {
  const roleOf = new Map(players.map((p) => [p.id, requireCurrentRole(p)]));
  const eliminated = new Set(votedEliminated);
  chainHunterKills(roleOf, votes, eliminated);

  const finalEliminated = [...eliminated];
  const eliminatedRoles = finalEliminated.map((id) => roleOf.get(id));
  const tannerDied = eliminatedRoles.includes("tanner");
  const werewolfDied = eliminatedRoles.includes("werewolf");

  const winningTeam: WinningTeam = tannerDied ? "tanner" : werewolfDied ? "village" : "werewolf";

  const winners = players
    .filter((p) => {
      const role = requireCurrentRole(p);
      if (winningTeam === "tanner") return role === "tanner" && eliminated.has(p.id);
      return roleTeam(role) === winningTeam;
    })
    .map((p) => p.id);

  return { eliminated: finalEliminated, winningTeam, winners };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- winConditions.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/state/winConditions.ts server/src/state/winConditions.test.ts
git commit -m "feat: add computeWinConditions with hunter chain-kills and tanner/minion edge cases"
```

---

## Task 6: Allow `REVEAL -> ROLE_SELECT` (`server/src/state/phases.ts`)

**Files:**
- Modify: `server/src/state/phases.ts`
- Modify: `server/src/state/phases.test.ts`

**Interfaces:**
- Produces: `canTransition("REVEAL", "ROLE_SELECT")` now `true`; `canTransition("REVEAL", "LOBBY")` now `false` (that transition was declared in Phase 1 but never used by any production code — confirmed by grep, only asserted in this test file — so this plan repurposes it rather than adding a second allowed target).

- [ ] **Step 1: Write the failing test**

In `server/src/state/phases.test.ts`, change the `it.each` transition-allow list:

```typescript
  it.each([
    ["LOBBY", "ROLE_SELECT"],
    ["ROLE_SELECT", "NIGHT"],
    ["ROLE_SELECT", "LOBBY"],
    ["NIGHT", "DAY"],
    ["DAY", "VOTE"],
    ["VOTE", "REVEAL"],
    ["REVEAL", "ROLE_SELECT"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
```

and add a new rejected case to the `it.each` reject list:

```typescript
  it.each([
    ["LOBBY", "NIGHT"],
    ["NIGHT", "LOBBY"],
    ["DAY", "REVEAL"],
    ["REVEAL", "LOBBY"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- phases.test`
Expected: FAIL — `canTransition("REVEAL", "ROLE_SELECT")` is `false`; `canTransition("REVEAL", "LOBBY")` is `true`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/state/phases.ts`:

```typescript
  REVEAL: ["ROLE_SELECT"],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- phases.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/state/phases.ts server/src/state/phases.test.ts
git commit -m "feat: repurpose the unused REVEAL->LOBBY transition into REVEAL->ROLE_SELECT for Rejouer"
```

---

## Task 7: Wire win-condition computation into vote resolution (`server/src/day/voteEvents.ts`)

**Files:**
- Modify: `server/src/day/voteEvents.ts`
- Modify: `server/src/day/voteEvents.test.ts`

**Interfaces:**
- Consumes: `computeWinConditions` (Task 5), `toRevealPlayers` (Task 4)
- Produces: `GameState.reveal` is set the instant the last vote resolves; `REVEAL_RESULT` is broadcast to the room alongside the existing `VOTE_RESULT`.

- [ ] **Step 1: Write the failing test**

In `server/src/day/voteEvents.test.ts`, update the `fixture` helper to give every player a `currentRoleId` (required by `requireCurrentRole` once win conditions run):

```typescript
function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "VOTE",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", originalRoleId: "villager", currentRoleId: "villager" },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true, reconnectToken: "t3", originalRoleId: "seer", currentRoleId: "seer" },
    ],
    center: [],
    night: null,
    day: null,
    vote: { votes: {} },
    reveal: null,
    roleSelection: null,
    lastRoleSelection: null,
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
  };
}
```

Then add this test right after the existing "resolves and broadcasts VOTE_RESULT..." test:

```typescript
  it("computes and persists the win conditions, and broadcasts REVEAL_RESULT alongside VOTE_RESULT", async () => {
    await createRoom(fixture("MNOP"));
    const io = fakeIo();
    const s1 = fakeSocket();
    const s2 = fakeSocket();
    const s3 = fakeSocket();
    registerVoteEvents(io as never, s1 as never, () => ({ roomCode: "MNOP", playerId: "p1" }));
    registerVoteEvents(io as never, s2 as never, () => ({ roomCode: "MNOP", playerId: "p2" }));
    registerVoteEvents(io as never, s3 as never, () => ({ roomCode: "MNOP", playerId: "p3" }));

    // Everyone votes p1 (the werewolf) out — Village should win.
    await s1.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });
    await s2.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });
    await s3.trigger("SUBMIT_VOTE", { targetPlayerId: "p1" });

    const room = await getRoom("MNOP");
    expect(room?.reveal).toEqual({ eliminated: ["p1"], winningTeam: "village", winners: ["p2", "p3"] });

    const revealEvent = io.emitted.find((e) => e.event === "REVEAL_RESULT");
    expect(revealEvent?.payload).toEqual({
      eliminated: ["p1"],
      winningTeam: "village",
      winners: ["p2", "p3"],
      players: [
        { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
        { id: "p3", pseudo: "Carl", originalRoleId: "seer", currentRoleId: "seer" },
      ],
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- voteEvents.test`
Expected: FAIL — `room?.reveal` is `undefined`; no `REVEAL_RESULT` event emitted.

- [ ] **Step 3: Write minimal implementation**

In `server/src/day/voteEvents.ts`, update the imports:

```typescript
import { resolveVotes, type VoteResult } from "../state/voteResolver.js";
import { computeWinConditions } from "../state/winConditions.js";
import { toRevealPlayers } from "../rooms/roomView.js";
```

Then change the `SUBMIT_VOTE` handler body — replace the `withRoom` callback's resolution branch:

```typescript
        result = resolveVotes(
          votes,
          room.players.map((p) => p.id),
        );
        const reveal = computeWinConditions(room.players, votes, result.eliminated);
        return { ...transition(room, "REVEAL"), vote: null, reveal, updatedAt: Date.now() };
```

and after the existing `io.to(state.roomCode).emit("VOTE_RESULT", result);` line, add:

```typescript
        io.to(state.roomCode).emit("VOTE_RESULT", result);
        if (state.reveal) {
          io.to(state.roomCode).emit("REVEAL_RESULT", { ...state.reveal, players: toRevealPlayers(state) });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- voteEvents.test`
Expected: PASS

- [ ] **Step 5: Run the full server suite**

Run: `npm run test -w server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/day/voteEvents.ts server/src/day/voteEvents.test.ts
git commit -m "feat: compute win conditions on vote resolution and broadcast REVEAL_RESULT"
```

---

## Task 8: Reconnect catch-up for REVEAL (`server/src/rooms/roomEvents.ts`)

**Files:**
- Modify: `server/src/rooms/roomEvents.ts`
- Modify: `server/src/rooms/roomEvents.test.ts`

**Interfaces:**
- Consumes: `toRevealPlayers` (Task 4)
- Produces: a reconnecting/refreshing client whose room is already in `REVEAL` immediately receives `REVEAL_RESULT`, same as the existing `DAY_START`/`VOTE_START` catch-up.

- [ ] **Step 1: Write the failing test**

This file has no existing test for the `DAY_START`/`VOTE_START` reconnect catch-up specifically — the closest precedent is the `"pauses the tick on disconnect during NIGHT and resumes it on reconnect"` test near the bottom of `server/src/rooms/roomEvents.test.ts`, which uses the file's `fakeIoWithNoOtherSockets()`/`fakeSocketJoinedAs()` fakes (not a real socket.io-client connection) to drive `registerRoomEvents` directly. Reuse that same pattern — add this test right after it, inside the `describe("room events", ...)` block:

```typescript
  it("re-sends REVEAL_RESULT on reconnect when the room is already in REVEAL", async () => {
    await createRoom({
      roomCode: "RVL01",
      phase: "REVEAL",
      players: [
        { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "tok1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "tok2", originalRoleId: "villager", currentRoleId: "villager" },
      ],
      center: [],
      night: null,
      day: null,
      vote: null,
      reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2"] },
      roleSelection: null,
      lastRoleSelection: null,
      dayDurationMs: 240_000,
      createdAt: 0,
      updatedAt: 0,
    });

    const disconnectHandler = createDisconnectHandler({
      tickRunner: { pauseTick: vi.fn(), resumeTick: vi.fn() },
    });
    const io = fakeIoWithNoOtherSockets();
    const socket = fakeSocketJoinedAs("p1", "RVL01", "tok1");

    registerRoomEvents(io as never, socket as never, { startNight: vi.fn() }, disconnectHandler);

    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalledWith("ROOM_JOINED", expect.anything()));

    expect(socket.emit).toHaveBeenCalledWith("REVEAL_RESULT", {
      eliminated: ["p1"],
      winningTeam: "village",
      winners: ["p2"],
      players: [
        { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
        { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
      ],
    });
  });
```

`createRoom`, `createDisconnectHandler`, `fakeIoWithNoOtherSockets`, `fakeSocketJoinedAs`, `registerRoomEvents`, and `vi` are all already imported at the top of this test file — no new imports needed for this step.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- roomEvents.test`
Expected: FAIL — no `REVEAL_RESULT` event emitted on reconnect.

- [ ] **Step 3: Write minimal implementation**

In `server/src/rooms/roomEvents.ts`, add the import:

```typescript
import { toPublicPlayers, toRevealPlayers } from "./roomView.js";
```

In the reconnect handler, right after the existing block:

```typescript
        if (state.phase === "VOTE") {
          socket.emit("VOTE_START", {});
        }
```

add:

```typescript
        if (state.phase === "REVEAL" && state.reveal) {
          socket.emit("REVEAL_RESULT", { ...state.reveal, players: toRevealPlayers(state) });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- roomEvents.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roomEvents.ts server/src/rooms/roomEvents.test.ts
git commit -m "feat: re-send REVEAL_RESULT on reconnect when the room is already in REVEAL"
```

---

## Task 9: `REPLAY` event (`server/src/rooms/replayEvents.ts`)

**Files:**
- Create: `server/src/rooms/replayEvents.ts`
- Create: `server/src/rooms/replayEvents.test.ts`
- Modify: `server/src/rooms/roomEvents.ts` (wire the new registrar into `registerRoomEvents`)

**Interfaces:**
- Consumes: `withRoom` (`roomStore.ts`), `transition` (`phases.ts`, Task 6), `validateRoleSelection` (shared), `Membership` (`roleSelectEvents.ts`)
- Produces: `registerReplayEvents(io, socket, getMembership): void`, called the same way as the other four registrars already are in `registerRoomEvents`.

- [ ] **Step 1: Write the failing test**

Create `server/src/rooms/replayEvents.test.ts`, mirroring the existing `voteEvents.test.ts` structure (same `fakeSocket`/`fakeIo` shape, same Redis-on-db-15 setup):

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { GameState } from "@onuw/shared";
import { getRedisClient, closeRedisClient } from "../redis/client.js";
import { createRoom, getRoom } from "../rooms/roomStore.js";
import { registerReplayEvents } from "./replayEvents.js";

function fixture(roomCode: string): GameState {
  return {
    roomCode,
    phase: "REVEAL",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1", originalRoleId: "werewolf", currentRoleId: "werewolf" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2", originalRoleId: "villager", currentRoleId: "villager" },
    ],
    center: ["seer"],
    night: null,
    day: null,
    vote: null,
    reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2"] },
    roleSelection: null,
    lastRoleSelection: { mode: "classic", roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } },
    dayDurationMs: 240_000,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    on: (event: string, handler: (payload: unknown) => unknown) => handlers.set(event, handler),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    trigger: (event: string, payload: unknown) => handlers.get(event)!(payload),
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

describe("registerReplayEvents", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://localhost:6379/15";
  });
  afterEach(async () => {
    await getRedisClient().flushdb();
  });
  afterAll(async () => {
    await closeRedisClient();
  });

  it("resets the room to ROLE_SELECT with players/roles cleared and the last selection restored", async () => {
    await createRoom(fixture("UVWX"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "UVWX", playerId: "p1" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("UVWX");
    expect(room?.phase).toBe("ROLE_SELECT");
    expect(room?.center).toEqual([]);
    expect(room?.night).toBeNull();
    expect(room?.day).toBeNull();
    expect(room?.vote).toBeNull();
    expect(room?.reveal).toBeNull();
    expect(room?.players.every((p) => p.originalRoleId === undefined && p.currentRoleId === undefined)).toBe(true);
    expect(room?.roleSelection).toEqual({
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
    });

    const updateEvent = io.emitted.find((e) => e.event === "ROLE_SELECTION_UPDATE");
    expect(updateEvent?.payload).toEqual({
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      valid: true,
    });
  });

  it("rejects REPLAY from a non-host", async () => {
    await createRoom(fixture("YZAB"));
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "YZAB", playerId: "p2" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("YZAB");
    expect(room?.phase).toBe("REVEAL");
    expect(socket.emitted.find((e) => e.event === "ROOM_ERROR")?.payload).toEqual({
      message: "seul l'hôte peut relancer une partie",
    });
  });

  it("rejects REPLAY outside of REVEAL", async () => {
    await createRoom({ ...fixture("CDEF"), phase: "LOBBY" });
    const io = fakeIo();
    const socket = fakeSocket();
    registerReplayEvents(io as never, socket as never, () => ({ roomCode: "CDEF", playerId: "p1" }));

    await socket.trigger("REPLAY", undefined);

    const room = await getRoom("CDEF");
    expect(room?.phase).toBe("LOBBY");
    expect(socket.emitted.find((e) => e.event === "ROOM_ERROR")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- replayEvents.test`
Expected: FAIL — `Cannot find module './replayEvents.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/rooms/replayEvents.ts`:

```typescript
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";
import { validateRoleSelection } from "@onuw/shared";
import { withRoom } from "./roomStore.js";
import { transition } from "../state/phases.js";
import type { Membership } from "./roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

class NotHostError extends Error {}
class WrongPhaseError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut relancer une partie";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  return "impossible de relancer la partie";
}

export function registerReplayEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("REPLAY", async () => {
    const membership = getMembership();
    if (!membership) return;
    try {
      const state = await withRoom(membership.roomCode, (room) => {
        requireHost(room, membership.playerId);
        if (room.phase !== "REVEAL") throw new WrongPhaseError();

        const roleSelection = room.lastRoleSelection
          ? { mode: room.lastRoleSelection.mode, roles: { ...room.lastRoleSelection.roles } }
          : null;
        const players = room.players.map((p) => ({
          ...p,
          originalRoleId: undefined,
          currentRoleId: undefined,
        }));

        return {
          ...transition(room, "ROLE_SELECT"),
          players,
          center: [],
          night: null,
          day: null,
          vote: null,
          reveal: null,
          roleSelection,
          updatedAt: Date.now(),
        };
      });

      if (state.roleSelection) {
        const { valid } = validateRoleSelection(
          state.roleSelection.mode,
          state.players.length,
          state.roleSelection.roles,
        );
        io.to(state.roomCode).emit("ROLE_SELECTION_UPDATE", {
          mode: state.roleSelection.mode,
          roles: state.roleSelection.roles,
          valid,
        });
      }
    } catch (err) {
      socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- replayEvents.test`
Expected: PASS

- [ ] **Step 5: Wire the registrar into `registerRoomEvents`**

In `server/src/rooms/roomEvents.ts`, add the import next to the other registrar imports:

```typescript
import { registerReplayEvents } from "./replayEvents.js";
```

and add the call right after the existing `registerVoteEvents(io, socket, () => membership);`:

```typescript
  registerVoteEvents(io, socket, () => membership);
  registerReplayEvents(io, socket, () => membership);
```

- [ ] **Step 6: Run the full server suite**

Run: `npm run test -w server`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/rooms/replayEvents.ts server/src/rooms/replayEvents.test.ts server/src/rooms/roomEvents.ts
git commit -m "feat: add host-only REPLAY event resetting a REVEAL room back to ROLE_SELECT"
```

---

## Task 10: Client socket state for reveal/replay (`client/src/hooks/useRoomSocket.ts`)

**Files:**
- Modify: `client/src/hooks/useRoomSocket.ts`
- Modify: `client/src/hooks/useRoomSocket.test.ts`

**Interfaces:**
- Consumes: `REVEAL_RESULT` (server->client), `REPLAY` (client->server)
- Produces: `RoomSession.revealResult: RevealResultState | null`, `RoomSession.replay: () => void` — consumed by Task 11 (`Reveal.tsx`) and Task 12 (`Vote.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `client/src/hooks/useRoomSocket.test.ts`:

```typescript
  it("stores the reveal result on REVEAL_RESULT", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("REVEAL_RESULT", {
        eliminated: ["p1"],
        winningTeam: "village",
        winners: ["p2"],
        players: [{ id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" }],
      });
    });

    expect(result.current.revealResult?.winningTeam).toBe("village");
    expect(result.current.revealResult?.players[0].pseudo).toBe("Alice");
  });

  it("emits REPLAY when replay() is called", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      result.current.replay();
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("REPLAY");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useRoomSocket.test`
Expected: FAIL — `result.current.revealResult` is `undefined`; `result.current.replay` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `client/src/hooks/useRoomSocket.ts`, extend the import:

```typescript
import type {
  ClientToServerEvents,
  GameMode,
  NightTickId,
  PublicPlayer,
  RevealPlayer,
  RoleCounts,
  ServerToClientEvents,
} from "@onuw/shared";
```

Add a new exported interface right after `VoteResultState`:

```typescript
export interface RevealResultState {
  eliminated: string[];
  winningTeam: "village" | "werewolf" | "tanner";
  winners: string[];
  players: RevealPlayer[];
}
```

Add the field and callback to `RoomSession`:

```typescript
  voteResult: VoteResultState | null;
  setDayDuration: (durationMs: number) => void;
  submitVote: (targetPlayerId: string) => void;
  revealResult: RevealResultState | null;
  replay: () => void;
```

Inside `useRoomSocket`, add the state:

```typescript
  const [revealResult, setRevealResult] = useState<RevealResultState | null>(null);
```

Register the listener next to `socket.on("VOTE_RESULT", ...)`:

```typescript
    socket.on("VOTE_RESULT", (payload) => setVoteResult(payload));
    socket.on("REVEAL_RESULT", (payload) => setRevealResult(payload));
```

Add the callback next to `submitVote`:

```typescript
  const replay = useCallback(() => {
    socketRef.current?.emit("REPLAY");
  }, []);
```

And return the two new values from the hook:

```typescript
    setDayDuration,
    submitVote,
    revealResult,
    replay,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useRoomSocket.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useRoomSocket.ts client/src/hooks/useRoomSocket.test.ts
git commit -m "feat: track revealResult and expose replay() in useRoomSocket"
```

---

## Task 11: `Reveal.tsx` page + route

**Files:**
- Create: `client/src/pages/Reveal.tsx`
- Create: `client/src/pages/Reveal.test.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/App.test.tsx`

**Interfaces:**
- Consumes: `revealResult`, `replay`, `roleSelection`, `players`, `playerId` (`useRoomSocket`, Task 10), `roleLabel` (`roleLabels.ts`)
- Produces: the `/room/:roomCode/reveal` route.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Reveal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Reveal from "./Reveal";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
    ],
    roleSelection: null,
    revealResult: null,
    replay: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/reveal" element={<Reveal />} />
        <Route path="/room/:roomCode/roles" element={<div>roles-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Reveal", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReset();
  });

  it("shows a waiting message before the reveal result arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCD/reveal");
    expect(screen.getByText(/en attente/i)).toBeInTheDocument();
  });

  it("shows the winning team and each player's original/final role", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: {
          eliminated: ["p1"],
          winningTeam: "village",
          winners: ["p2"],
          players: [
            { id: "p1", pseudo: "Alice", originalRoleId: "werewolf", currentRoleId: "werewolf" },
            { id: "p2", pseudo: "Bob", originalRoleId: "villager", currentRoleId: "villager" },
          ],
        },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.getByText(/village/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/loup-garou/i)).toBeInTheDocument();
    expect(screen.getByText(/éliminé/i)).toBeInTheDocument();
  });

  it("shows the Rejouer button only for the host, and calls replay() on click", () => {
    const replay = vi.fn();
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], players: [] },
        replay,
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    const button = screen.getByRole("button", { name: /rejouer/i });
    fireEvent.click(button);
    expect(replay).toHaveBeenCalled();
  });

  it("hides the Rejouer button from non-hosts", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        playerId: "p2",
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], players: [] },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.queryByRole("button", { name: /rejouer/i })).not.toBeInTheDocument();
  });

  it("navigates to the role select page once roleSelection reappears after Rejouer", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: { eliminated: [], winningTeam: "werewolf", winners: [], players: [] },
        roleSelection: { mode: "classic", roles: { werewolf: 2 }, valid: true },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/reveal");

    expect(screen.getByText("roles-page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- Reveal.test`
Expected: FAIL — `Cannot find module './Reveal'`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/Reveal.tsx`:

```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { roleLabel } from "../roleLabels";

const WINNING_TEAM_LABELS: Record<"village" | "werewolf" | "tanner", string> = {
  village: "Le Village gagne !",
  werewolf: "Les Loups-Garous gagnent !",
  tanner: "Le Tanneur gagne, seul !",
};

function Reveal() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, roleSelection, revealResult, replay } = useRoomSocket();

  useEffect(() => {
    if (roleSelection && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/roles`);
    }
  }, [roleSelection, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (!revealResult) {
    return <p>En attente du résultat…</p>;
  }

  return (
    <div>
      <h1>Révélation — {routeRoomCode}</h1>
      <p>{WINNING_TEAM_LABELS[revealResult.winningTeam]}</p>
      <ul>
        {revealResult.players.map((p) => (
          <li key={p.id}>
            {p.pseudo} — {roleLabel(p.originalRoleId)}
            {p.originalRoleId !== p.currentRoleId ? ` → ${roleLabel(p.currentRoleId)}` : ""}
            {revealResult.eliminated.includes(p.id) ? " — éliminé" : ""}
            {revealResult.winners.includes(p.id) ? " 🏆" : ""}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button onClick={() => replay()}>Rejouer</button>
      ) : (
        <p>En attente de l'hôte pour rejouer…</p>
      )}
    </div>
  );
}

export default Reveal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- Reveal.test`
Expected: PASS

- [ ] **Step 5: Wire the route into `App.tsx`**

In `client/src/App.tsx`:

```tsx
import Vote from "./pages/Vote";
import Reveal from "./pages/Reveal";
```

```tsx
        <Route path="/room/:roomCode/vote" element={<Vote />} />
        <Route path="/room/:roomCode/reveal" element={<Reveal />} />
```

In `client/src/App.test.tsx`, add `revealResult: null` and `replay: vi.fn()` to both existing `mockReturnValue` objects (the ones under "renders Home..." and "renders RoleSelect...") so the mocked `RoomSession` shape stays complete — the client build type-checks test fixtures (see Global Constraints).

- [ ] **Step 6: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Reveal.tsx client/src/pages/Reveal.test.tsx client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: add Reveal.tsx with win banner, per-player role reveal, and host-only Rejouer"
```

---

## Task 12: `Vote.tsx` navigates to Reveal instead of rendering the result inline

**Files:**
- Modify: `client/src/pages/Vote.tsx`
- Modify: `client/src/pages/Vote.test.tsx`

**Interfaces:**
- Consumes: `revealResult` (`useRoomSocket`, Task 10)
- Produces: `Vote.tsx` no longer renders a result screen itself — `Reveal.tsx` (Task 11) owns that now.

- [ ] **Step 1: Write the failing test**

In `client/src/pages/Vote.test.tsx`, add `revealResult: null` to `baseSession`'s overrides object, then replace the existing test that asserts the inline "Résultat du vote" rendering (search for `voteResult` usage in this file) with:

```typescript
  it("navigates to the reveal page once the reveal result arrives", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({
        revealResult: {
          eliminated: ["p1"],
          winningTeam: "village",
          winners: ["p2", "p3"],
          players: [],
        },
      }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCD/vote");
    expect(screen.getByText("reveal-page")).toBeInTheDocument();
  });
```

and update the `renderAt` helper in the same file to register the destination route:

```typescript
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/vote" element={<Vote />} />
        <Route path="/room/:roomCode/reveal" element={<div>reveal-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- Vote.test`
Expected: FAIL — no navigation happens, `reveal-page` never renders.

- [ ] **Step 3: Write minimal implementation**

In `client/src/pages/Vote.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Vote() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { players, revealResult, submitVote } = useRoomSocket();
  const [votedFor, setVotedFor] = useState<string | null>(null);

  useEffect(() => {
    if (revealResult && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/reveal`);
    }
  }, [revealResult, routeRoomCode, navigate]);

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

- [ ] **Step 5: Run the full client suite and the build**

Run: `npm run test -w client && npm run build -w client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Vote.tsx client/src/pages/Vote.test.tsx
git commit -m "feat: navigate Vote.tsx to the Reveal page instead of rendering the result inline"
```

---

## Final Verification

- [ ] Run the entire monorepo suite: `npm run test`
- [ ] Run the entire monorepo build: `npm run build`
- [ ] Run lint: `npm run lint`

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** win conditions for Village/Werewolf/Tanner/Minion-without-Werewolf/Hunter-chain (Task 5), per-player final role reveal (Tasks 4/7/11), "Rejouer" that keeps the room+players and lets the host keep-or-edit the role config (Tasks 2/9/11) — all of the master phase plan's Phase 6 deliverables are covered. Center-card reveal was considered and deliberately left out: the spec's Phase 6 line only asks for "le rôle final de chacun" (each *player's* role), not the center cards, so adding it would be scope creep.
- **Type-consistency check across tasks:** `RevealState`/`RevealPlayer`/`RevealPayload`/`WinningTeam` field names are identical everywhere they cross a task boundary (`reveal.eliminated`/`.winningTeam`/`.winners`, `RevealPlayer.originalRoleId`/`.currentRoleId`). `RoomSession.revealResult`/`.replay` names match what `Reveal.tsx` and `Vote.tsx` destructure in Tasks 11–12. The `REVEAL -> ROLE_SELECT` transition (Task 6) is what `replayEvents.ts` (Task 9) relies on via `transition(room, "ROLE_SELECT")`.
- **Known limitation, deliberately deferred (not built here, flagged again per this project's convention):** a player who disconnects during VOTE and never reconnects still blocks vote resolution forever (Phase 5's limitation, untouched by this plan — no spec requirement forces a fix and none is invented here).
- **A second limitation worth flagging before this ships:** `REPLAY` resets `dayDurationMs`? No — it deliberately does **not** reset `dayDurationMs`, so a host who set a custom day length keeps it across replays; this was a judgment call (not explicitly specified either way) consistent with "keep what the host configured unless told otherwise."
