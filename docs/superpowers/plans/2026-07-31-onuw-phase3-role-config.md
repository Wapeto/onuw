# Phase 3 — Configuration des rôles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host pick a role composition (Classique / Simple / Personnalisé) that everyone in the room sees live, gate a "Lancer la partie" button on a valid selection, deal roles to players + center on launch, and kick off the already-built Phase 1 night-tick sequence.

**Architecture:** Server stays authoritative — `GameState.roleSelection` lives in Redis alongside the rest of the room, mutated only through `withRoom` (same atomic read-modify-write pattern Phase 2 introduced for joins). A single pure rule-engine (`validateRoleSelection` in `@onuw/shared`) is the one place total-count and role-compat rules are defined, imported by both the server (to enforce) and the client (to gray out invalid controls) — this is exactly the kind of drift `/shared` exists to prevent. Launch reuses Phase 1's already-implemented `createTickRunner().startNight()` unchanged; Phase 3 only adds the role-dealing step in front of it and wires the runner into the live app for the first time (Phase 1 built it "testable in isolation, no UI needed" but never instantiated it inside `createApp()`).

**Tech Stack:** Same as Phase 0-2 — TypeScript strict, Socket.io + zod payload validation, Redis via `withRoom`, React + Vitest + React Testing Library.

## Global Constraints

- Server is authoritative for role logic; the client never computes final validity, only mirrors the server's `valid` flag for UI graying (server re-validates on every mutating event, never trusts client state).
- `RoleCounts` is a per-role **count** map (`Partial<Record<RoleId, number>>`), not a set — Werewolf and Mason need duplicate cards in the same selection.
- Total selected cards must equal `players.length + 3` exactly before "Lancer la partie" is enabled — this is the one hard constraint that applies in all three modes.
- Mason is always 0 or 2 (masons are an inseparable pair in the physical game — never 1).
- Insomniac requires Robber and/or Troublemaker to also be in the selection (a card-swap role with nothing to react to is dead weight — this is the same rule the Phase 0 preset design already cited from the rulebook).
- Doppelganger and Village Idiot (`villageIdiot`) are selectable **only** in Personnalisé (custom) mode — Classique and Simple never include them, per the decisions table locked in `docs/superpowers/plans/2026-07-28-onuw-web-app.md`.
- Mode "Simple" is villagers + werewolves only, **no other role, ever** — it exists as an onboarding/tutorial mode (spec §5), not a stripped-down Classique.
- `MIN_PLAYERS = 3`, `MAX_PLAYERS = 10` — no preset exists outside this range (matches the physical game's supported range).
- The 6-10 player Classique table is this project's own extrapolation beyond the official 3/5-player rulebook (documented and flagged for review in the Phase-breakdown doc). While transcribing it into code for this plan, the 10-player row as originally written ("+ Mason, Mason, replace 2 Villagers") doesn't balance — 9-player total is 12 cards, replacing 2 Villagers with 2 Masons nets 0 change, landing on 12, but 10 players need 13. This plan corrects it to **replace 1 Villager** (not 2), which nets +1 card and lands on the required 13 while still respecting the Mason-pair rule. Flagged here explicitly rather than silently propagated — see Task 1.
- Village Idiot's actual night/dawn action is **not** implemented in this phase — Phase 3 only makes it selectable and dealable in Custom mode, to "stress-test extensibility" of the role-count model per the Phase-breakdown decisions table. Its resolver is Phase 4 scope (it isn't in `NIGHT_ORDER` yet, and adding it there is out of scope here).
- No comments explaining *what* code does — only non-obvious *why* (matches existing files like `roomEvents.ts`, `actionResolvers.ts`).

---

## Task 1: Extend shared types — `GameMode`, `RoleCounts`, `RoleSelection`, new socket events

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/types.test.ts`
- Modify: `server/src/rooms/roomEvents.ts:105-115` (the `CREATE_ROOM` candidate literal needs the new mandatory `GameState.roleSelection` field)

**Interfaces:**
- Produces: `GameMode = "classic" | "simple" | "custom"`; `RoleCounts = Partial<Record<RoleId, number>>`; `RoleSelection = { mode: GameMode; roles: RoleCounts }`; `GameState.roleSelection: RoleSelection | null`; four new `ClientToServerEvents` members (`START_ROLE_SELECT`, `SET_ROLE_MODE`, `SET_CUSTOM_ROLES`, `START_GAME`); one new `ServerToClientEvents` member (`ROLE_SELECTION_UPDATE`).

- [ ] **Step 1: Write the failing test**

`roleSelection` is about to become a required field on `GameState`. `shared/src/types.test.ts` already has one existing `GameState` object literal, in the `"GameState shape"` describe block's `"allows a full night-in-progress state"` test, that doesn't set it — add `roleSelection: null,` right after that test's existing `night,` line so it still compiles once the field is required:

```ts
    const state: GameState = {
      roomCode: "ABCD",
      phase: "NIGHT",
      players: [player],
      center: ["villager", "villager", "tanner"],
      night,
      roleSelection: null,
      createdAt: 500,
      updatedAt: 1000,
    };
```

Then add to `shared/src/types.test.ts`, inside a new `describe` block appended after the existing `"lobby event contracts"` block:

```ts
describe("role-select event contracts", () => {
  it("GameState carries a nullable roleSelection", () => {
    const empty: GameState = {
      roomCode: "ABCD",
      phase: "LOBBY",
      players: [],
      center: [],
      night: null,
      roleSelection: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const withSelection: GameState = {
      ...empty,
      phase: "ROLE_SELECT",
      roleSelection: { mode: "classic", roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } },
    };

    expect(empty.roleSelection).toBeNull();
    expect(withSelection.roleSelection?.mode).toBe("classic");
    expect(withSelection.roleSelection?.roles.werewolf).toBe(2);
  });

  it("wires START_ROLE_SELECT/SET_ROLE_MODE/SET_CUSTOM_ROLES/START_GAME and the ROLE_SELECTION_UPDATE broadcast", () => {
    const clientEvents: ClientToServerEvents = {
      ping: () => {},
      CREATE_ROOM: () => {},
      JOIN_ROOM: () => {},
      START_ROLE_SELECT: () => {},
      SET_ROLE_MODE: () => {},
      SET_CUSTOM_ROLES: () => {},
      START_GAME: () => {},
    };
    const serverEvents: ServerToClientEvents = {
      connected: () => {},
      ROOM_CREATED: () => {},
      ROOM_JOINED: () => {},
      PLAYER_LIST_UPDATE: () => {},
      ROOM_ERROR: () => {},
      ROLE_SELECTION_UPDATE: () => {},
    };

    expect(typeof clientEvents.START_GAME).toBe("function");
    expect(typeof serverEvents.ROLE_SELECTION_UPDATE).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `roleSelection` does not exist on type `GameState`, `START_ROLE_SELECT` etc. don't exist on `ClientToServerEvents`.

- [ ] **Step 3: Write minimal implementation**

In `shared/src/types.ts`, add after the `RoomPhase` type (right before `interface Player`):

```ts
export type GameMode = "classic" | "simple" | "custom";

export type RoleCounts = Partial<Record<RoleId, number>>;

export interface RoleSelection {
  mode: GameMode;
  roles: RoleCounts;
}
```

Add `roleSelection: RoleSelection | null;` to the `GameState` interface, right after the existing `night: NightState | null;` line.

Extend `ClientToServerEvents`:

```ts
export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
}
```

Extend `ServerToClientEvents`:

```ts
export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
  ROLE_SELECTION_UPDATE: (payload: { mode: GameMode; roles: RoleCounts; valid: boolean }) => void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS

- [ ] **Step 5: Fix every now-broken `GameState` literal across server**

`roleSelection` is a new required field, so every full `GameState` object literal in the codebase needs it added — `withRoom`/spread-based mutations (like `JOIN_ROOM`'s) inherit it automatically and need no change, but hand-built literals don't. Add `roleSelection: null,` right after the existing `night: null,` (or `night,`) line in each of these six spots:

1. `server/src/rooms/roomEvents.ts` — the `CREATE_ROOM` handler's `candidate` object literal (around line 105):
   ```ts
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
2. `server/src/rooms/roomStore.test.ts:12` — the `fixture()` helper's return literal, right after `night: null,`.
3. `server/src/state/phases.test.ts:10` — the top-level `base` literal, right after `night: null,`.
4. `server/src/night/tickRunner.test.ts:22` — the room-state fixture literal, right after `night: null,`.
5. `server/src/rooms/roomView.test.ts:14` — the `fixture()` helper's return literal, right after `night: null,`.
6. `server/src/roles/actionResolvers.test.ts:16` — the single-line `stateWith()` helper: change
   `return { roomCode: "ABCD", phase: "NIGHT", players, center, night: null, createdAt: 0, updatedAt: 0 };`
   to
   `return { roomCode: "ABCD", phase: "NIGHT", players, center, night: null, roleSelection: null, createdAt: 0, updatedAt: 0 };`

Run: `npm run build -w shared && npm run build -w server && npm run test -w server`
Expected: PASS — `tsc` catches any remaining literal this list missed (search its error output for `roleSelection` if it doesn't compile clean the first time); all existing server tests stay green since none of these fixtures' behavior changed, only their shape.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts shared/src/types.test.ts server/src/rooms/roomEvents.ts server/src/rooms/roomStore.test.ts server/src/state/phases.test.ts server/src/night/tickRunner.test.ts server/src/rooms/roomView.test.ts server/src/roles/actionResolvers.test.ts
git commit -m "feat: add GameMode/RoleCounts/RoleSelection types and role-select event contracts"
```

---

## Task 2: `shared/src/rolePresets.ts` — preset tables and the shared validation rule engine

**Files:**
- Create: `shared/src/rolePresets.ts`
- Create: `shared/src/rolePresets.test.ts`
- Create: `shared/src/index.ts` (barrel — `shared` currently has only one exported file, `types.ts`, wired directly as the package entry point; this task adds a second file, so it needs a real entry point)
- Modify: `shared/package.json` (`main`/`types` → the new barrel)

**Interfaces:**
- Consumes: `RoleId`, `ROLE_IDS`, `GameMode`, `RoleCounts` from `./types.js` (Task 1)
- Produces: `MIN_PLAYERS`, `MAX_PLAYERS`; `buildClassicPreset(playerCount: number): RoleCounts`; `buildSimplePreset(playerCount: number): RoleCounts`; `totalRoleCount(roles: RoleCounts): number`; `flattenRoleCounts(roles: RoleCounts): RoleId[]`; `validateRoleSelection(mode: GameMode, playerCount: number, roles: RoleCounts): { valid: boolean; errors: string[] }` — all re-exported from `@onuw/shared` via the new barrel.

- [ ] **Step 1: Write the failing test**

Create `shared/src/rolePresets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildClassicPreset,
  buildSimplePreset,
  totalRoleCount,
  flattenRoleCounts,
  validateRoleSelection,
} from "./rolePresets";

describe("buildClassicPreset", () => {
  it("matches the official 3-player rulebook composition", () => {
    expect(buildClassicPreset(3)).toEqual({
      werewolf: 2,
      seer: 1,
      robber: 1,
      troublemaker: 1,
      villager: 1,
    });
  });

  it("matches the official 5-player rulebook composition (3 villagers)", () => {
    const preset = buildClassicPreset(5);
    expect(preset.villager).toBe(3);
    expect(totalRoleCount(preset)).toBe(8);
  });

  it("pairs masons and lands on N+3 for the corrected 10-player extrapolation", () => {
    const preset = buildClassicPreset(10);
    expect(preset.mason).toBe(2);
    expect(totalRoleCount(preset)).toBe(13);
  });

  it("totals N+3 for every supported player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(totalRoleCount(buildClassicPreset(n))).toBe(n + 3);
    }
  });

  it("throws outside the 3-10 player range", () => {
    expect(() => buildClassicPreset(2)).toThrow();
    expect(() => buildClassicPreset(11)).toThrow();
  });
});

describe("buildSimplePreset", () => {
  it("is always exactly 2 werewolves and N+1 villagers, nothing else", () => {
    const preset = buildSimplePreset(6);
    expect(preset).toEqual({ werewolf: 2, villager: 7 });
    expect(totalRoleCount(preset)).toBe(9);
  });

  it("totals N+3 for every supported player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(totalRoleCount(buildSimplePreset(n))).toBe(n + 3);
    }
  });
});

describe("flattenRoleCounts", () => {
  it("expands counts into a flat RoleId array in ROLE_IDS order", () => {
    const flat = flattenRoleCounts({ werewolf: 2, villager: 1 });
    expect(flat).toEqual(["werewolf", "werewolf", "villager"]);
  });

  it("round-trips through totalRoleCount as the array length", () => {
    const roles = buildClassicPreset(7);
    expect(flattenRoleCounts(roles)).toHaveLength(totalRoleCount(roles));
  });
});

describe("validateRoleSelection", () => {
  it("accepts every classic preset as valid for its own player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const result = validateRoleSelection("classic", n, buildClassicPreset(n));
      expect(result).toEqual({ valid: true, errors: [] });
    }
  });

  it("accepts every simple preset as valid for its own player count", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(validateRoleSelection("simple", n, buildSimplePreset(n)).valid).toBe(true);
    }
  });

  it("rejects a total that doesn't equal playerCount + 3", () => {
    const result = validateRoleSelection("custom", 5, { werewolf: 2, villager: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("8"))).toBe(true);
  });

  it("rejects a single mason (masons must be 0 or 2)", () => {
    const result = validateRoleSelection("custom", 5, {
      werewolf: 2, seer: 1, robber: 1, mason: 1, villager: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("maçon"))).toBe(true);
  });

  it("rejects insomniac without robber or troublemaker in the selection", () => {
    const result = validateRoleSelection("custom", 6, {
      werewolf: 2, seer: 1, insomniac: 1, villager: 5,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("insomniaque"))).toBe(true);
  });

  it("accepts insomniac when robber is present", () => {
    const result = validateRoleSelection("custom", 6, {
      werewolf: 2, robber: 1, insomniac: 1, villager: 5,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects doppelganger in classic or simple mode", () => {
    const asClassic = validateRoleSelection("classic", 5, { werewolf: 2, doppelganger: 1, villager: 5 });
    expect(asClassic.valid).toBe(false);
    expect(asClassic.errors.some((e) => e.includes("doppelganger"))).toBe(true);
  });

  it("accepts doppelganger and villageIdiot in custom mode", () => {
    const result = validateRoleSelection("custom", 5, {
      werewolf: 2, doppelganger: 1, villageIdiot: 1, villager: 4,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a second copy of a singleton role like seer", () => {
    const result = validateRoleSelection("custom", 5, { werewolf: 2, seer: 2, villager: 4 });
    expect(result.valid).toBe(false);
  });

  it("rejects a player count outside 3-10", () => {
    const result = validateRoleSelection("custom", 2, { werewolf: 2, villager: 3 });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w shared`
Expected: FAIL — `./rolePresets` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `shared/src/rolePresets.ts`:

```ts
import { ROLE_IDS } from "./types.js";
import type { GameMode, RoleCounts, RoleId } from "./types.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

// Sourced from the official Bezier Games rulebook for 3 and 5 players; 4 is the
// documented midpoint (base 3p + 1 Villager). 6-10 are this project's own
// extrapolation of the rulebook's stated philosophy ("add 1-2 roles at a time"),
// not official compositions — see docs/superpowers/plans/2026-07-28-onuw-web-app.md
// §Presets Classique. The 10-player row corrects an arithmetic error in that
// source doc: "replace 2 Villagers with Mason,Mason" nets 0 cards (12 -> 12),
// but 10 players need 13 — this replaces 1 Villager (not 2) to net +1 and land
// on 13 while still respecting the Mason-pair rule.
const CLASSIC_PRESETS: Record<number, RoleCounts> = {
  3: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
  4: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 },
  5: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 3 },
  6: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, villager: 3 },
  7: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, villager: 3 },
  8: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, villager: 3 },
  9: {
    werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, hunter: 1, villager: 3,
  },
  10: {
    werewolf: 2, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, tanner: 1, minion: 1, hunter: 1, mason: 2,
    villager: 2,
  },
};

export function buildClassicPreset(playerCount: number): RoleCounts {
  const preset = CLASSIC_PRESETS[playerCount];
  if (!preset) throw new Error(`no classic preset for ${playerCount} players`);
  return { ...preset };
}

export function buildSimplePreset(playerCount: number): RoleCounts {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`no simple preset for ${playerCount} players`);
  }
  return { werewolf: 2, villager: playerCount + 1 };
}

export function totalRoleCount(roles: RoleCounts): number {
  return Object.values(roles).reduce((sum: number, count) => sum + (count ?? 0), 0);
}

export function flattenRoleCounts(roles: RoleCounts): RoleId[] {
  const flat: RoleId[] = [];
  for (const id of ROLE_IDS) {
    const count = roles[id] ?? 0;
    for (let i = 0; i < count; i++) flat.push(id);
  }
  return flat;
}

const SINGLETON_ROLES: RoleId[] = [
  "doppelganger", "seer", "robber", "troublemaker", "drunk", "minion", "insomniac", "hunter", "tanner", "villageIdiot",
];
const CUSTOM_ONLY_ROLES: RoleId[] = ["doppelganger", "villageIdiot"];

export interface RoleSelectionValidation {
  valid: boolean;
  errors: string[];
}

export function validateRoleSelection(
  mode: GameMode,
  playerCount: number,
  roles: RoleCounts,
): RoleSelectionValidation {
  const errors: string[] = [];

  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    errors.push(`le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}`);
  }

  const total = totalRoleCount(roles);
  const target = playerCount + 3;
  if (total !== target) {
    errors.push(`le total de rôles doit être exactement ${target} (actuellement ${total})`);
  }

  const werewolfCount = roles.werewolf ?? 0;
  if (werewolfCount > 2) errors.push("au maximum 2 loups-garous");

  const masonCount = roles.mason ?? 0;
  if (masonCount !== 0 && masonCount !== 2) errors.push("les maçons vont toujours par paire (0 ou 2)");

  const insomniacCount = roles.insomniac ?? 0;
  if (insomniacCount > 0 && (roles.robber ?? 0) === 0 && (roles.troublemaker ?? 0) === 0) {
    errors.push("l'insomniaque nécessite le voleur ou la semeuse de troubles dans la partie");
  }

  for (const roleId of SINGLETON_ROLES) {
    if ((roles[roleId] ?? 0) > 1) errors.push(`${roleId} ne peut apparaître qu'une seule fois`);
  }

  if (mode !== "custom") {
    for (const roleId of CUSTOM_ONLY_ROLES) {
      if ((roles[roleId] ?? 0) > 0) errors.push(`${roleId} n'est disponible qu'en mode personnalisé`);
    }
  }

  for (const roleId of ROLE_IDS) {
    if ((roles[roleId] ?? 0) < 0) errors.push(`${roleId} ne peut pas avoir un nombre négatif de cartes`);
  }

  return { valid: errors.length === 0, errors };
}
```

Create `shared/src/index.ts`:

```ts
export * from "./types.js";
export * from "./rolePresets.js";
```

In `shared/package.json`, change:

```json
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w shared`
Expected: PASS

- [ ] **Step 5: Rebuild shared and confirm server + client still resolve `@onuw/shared` correctly**

Run: `npm run build -w shared && npm run test -w server && npm run test -w client`
Expected: PASS. `dist/index.js` now exists and is what `@onuw/shared` resolves to; existing imports (`import type { GameState } from "@onuw/shared"` etc.) keep working unchanged since the barrel re-exports everything `types.ts` exported before.

- [ ] **Step 6: Commit**

```bash
git add shared/src/rolePresets.ts shared/src/rolePresets.test.ts shared/src/index.ts shared/package.json
git commit -m "feat: add role preset tables and shared role-selection validation"
```

---

## Task 3: `server/src/roles/presetValidation.ts` — server-side validity check and role dealing

**Files:**
- Create: `server/src/roles/presetValidation.ts`
- Create: `server/src/roles/presetValidation.test.ts`

**Interfaces:**
- Consumes: `GameState`, `flattenRoleCounts`, `validateRoleSelection` from `@onuw/shared` (Task 2)
- Produces: `isRoleSelectionValid(gameState: GameState): boolean`; `assignRoles(gameState: GameState, random?: () => number): GameState` — used by Task 4's `START_GAME` handler.

- [ ] **Step 1: Write the failing test**

Create `server/src/roles/presetValidation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { GameState } from "@onuw/shared";
import { isRoleSelectionValid, assignRoles } from "./presetValidation.js";

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode: "ABCD",
    phase: "ROLE_SELECT",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true, reconnectToken: "t1" },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true, reconnectToken: "t2" },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true, reconnectToken: "t3" },
    ],
    center: [],
    night: null,
    roleSelection: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("isRoleSelectionValid", () => {
  it("is false when there is no selection yet", () => {
    expect(isRoleSelectionValid(baseState())).toBe(false);
  });

  it("is true for a valid classic selection matching player count", () => {
    const state = baseState({
      roleSelection: {
        mode: "classic",
        roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      },
    });
    expect(isRoleSelectionValid(state)).toBe(true);
  });

  it("is false when the total doesn't match player count + 3", () => {
    const state = baseState({ roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 } } });
    expect(isRoleSelectionValid(state)).toBe(false);
  });
});

describe("assignRoles", () => {
  it("throws when the current selection is invalid", () => {
    const state = baseState({ roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 } } });
    expect(() => assignRoles(state)).toThrow();
  });

  it("deals a deterministic shuffle to players and center, and clears roleSelection", () => {
    const state = baseState({
      roleSelection: {
        mode: "classic",
        roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      },
    });

    // random() always returning 0 makes Fisher-Yates fully deterministic: every
    // iteration swaps the current tail element with index 0. Flattened deck in
    // ROLE_IDS order is [werewolf, werewolf, seer, robber, troublemaker, villager];
    // tracing the swaps by hand gives this exact final order.
    const result = assignRoles(state, () => 0);

    expect(result.players.map((p) => p.currentRoleId)).toEqual(["werewolf", "seer", "robber"]);
    expect(result.players.map((p) => p.originalRoleId)).toEqual(["werewolf", "seer", "robber"]);
    expect(result.center).toEqual(["troublemaker", "villager", "werewolf"]);
    expect(result.roleSelection).toBeNull();
  });

  it("always deals exactly 3 cards to the center regardless of player count", () => {
    const state = baseState({
      roleSelection: { mode: "simple", roles: { werewolf: 2, villager: 4 } },
    });
    const result = assignRoles(state, () => 0.5);
    expect(result.center).toHaveLength(3);
    expect(result.players.every((p) => p.currentRoleId !== undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `./presetValidation.js` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/roles/presetValidation.ts`:

```ts
import type { GameState } from "@onuw/shared";
import { flattenRoleCounts, validateRoleSelection } from "@onuw/shared";

export function isRoleSelectionValid(gameState: GameState): boolean {
  if (!gameState.roleSelection) return false;
  const { mode, roles } = gameState.roleSelection;
  return validateRoleSelection(mode, gameState.players.length, roles).valid;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

export function assignRoles(gameState: GameState, random: () => number = Math.random): GameState {
  if (!isRoleSelectionValid(gameState)) {
    throw new Error(`cannot assign roles: current selection is invalid for room ${gameState.roomCode}`);
  }
  const deck = shuffle(flattenRoleCounts(gameState.roleSelection!.roles), random);
  const playerCount = gameState.players.length;
  const dealtToPlayers = deck.slice(0, playerCount);
  const dealtToCenter = deck.slice(playerCount);

  const players = gameState.players.map((player, index) => ({
    ...player,
    originalRoleId: dealtToPlayers[index],
    currentRoleId: dealtToPlayers[index],
  }));

  return { ...gameState, players, center: dealtToCenter, roleSelection: null, updatedAt: Date.now() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/roles/presetValidation.ts server/src/roles/presetValidation.test.ts
git commit -m "feat: add server-side role-selection validity check and dealing"
```

---

## Task 4: `server/src/rooms/roleSelectEvents.ts` — socket handlers for role selection

**Files:**
- Create: `server/src/rooms/roleSelectEvents.ts`
- Create: `server/src/rooms/roleSelectEvents.test.ts`
- Modify: `server/src/rooms/roomEvents.ts` — export a `Membership` type, call `registerRoleSelectEvents` with a membership accessor + tick runner, catch up reconnecting clients on the current role selection

**Interfaces:**
- Consumes: `withRoom` (`./roomStore.js`), `transition` (`../state/phases.js`), `assignRoles` (`../roles/presetValidation.js`, Task 3), `MIN_PLAYERS`/`MAX_PLAYERS`/`buildClassicPreset`/`buildSimplePreset`/`validateRoleSelection` (`@onuw/shared`, Task 2)
- Produces: `registerRoleSelectEvents(io, socket, getMembership, tickRunner): void`, `Membership` type (re-exported from `roomEvents.ts`) — consumed by Task 5's wiring in `index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/rooms/roleSelectEvents.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import { createApp, listen } from "../index.js";
import { getRedisClient, closeRedisClient } from "../redis/client.js";

describe("role select events", () => {
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

  async function roomWithThreePlayers() {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });
    const guest1 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", () => resolve());
      guest1.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
    });
    const guest2 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", (p) => {
        if (p.players.length === 3) resolve();
      });
      guest2.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Carl" });
    });
    return { host, guest1, guest2, roomCode: created.roomCode };
  }

  it("defaults to the classic preset for the current player count on START_ROLE_SELECT", async () => {
    const { host, guest1, roomCode } = await roomWithThreePlayers();
    const guestUpdate = new Promise<{ mode: string; roles: Record<string, number>; valid: boolean }>((resolve) => {
      guest1.on("ROLE_SELECTION_UPDATE", resolve);
    });
    host.emit("START_ROLE_SELECT");
    const update = await guestUpdate;
    expect(update.mode).toBe("classic");
    expect(update.roles).toEqual({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 });
    expect(update.valid).toBe(true);
    expect(roomCode).toBeTruthy();
  });

  it("rejects START_ROLE_SELECT from a non-host", async () => {
    const { guest1 } = await roomWithThreePlayers();
    const err = new Promise<{ message: string }>((resolve) => guest1.on("ROOM_ERROR", resolve));
    guest1.emit("START_ROLE_SELECT");
    await expect(err).resolves.toMatchObject({ message: expect.any(String) });
  });

  it("switches to the simple preset (werewolves + villagers only) on SET_ROLE_MODE", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const update = new Promise<{ mode: string; roles: Record<string, number> }>((resolve) => {
      host.once("ROLE_SELECTION_UPDATE", resolve);
    });
    host.emit("SET_ROLE_MODE", { mode: "simple" });
    const result = await update;
    expect(result.mode).toBe("simple");
    expect(result.roles).toEqual({ werewolf: 2, villager: 4 });
  });

  it("applies a custom role selection via SET_CUSTOM_ROLES and reports validity", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_ROLE_MODE", { mode: "custom" });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const invalidUpdate = new Promise<{ valid: boolean }>((resolve) => host.once("ROLE_SELECTION_UPDATE", resolve));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, villager: 1 } });
    expect((await invalidUpdate).valid).toBe(false);

    const validUpdate = new Promise<{ valid: boolean }>((resolve) => host.once("ROLE_SELECTION_UPDATE", resolve));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } });
    expect((await validUpdate).valid).toBe(true);
  });

  it("deals roles and starts the night sequence on START_GAME", async () => {
    const { host, roomCode } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const tickStart = new Promise<{ tickIndex: number }>((resolve) => host.once("TICK_START", resolve));
    host.emit("START_GAME");
    const tick = await tickStart;
    expect(tick.tickIndex).toBe(0);
    expect(roomCode).toBeTruthy();
  });

  it("rejects START_GAME while the selection is still invalid", async () => {
    const { host } = await roomWithThreePlayers();
    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_ROLE_MODE", { mode: "custom" });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));
    host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 1, villager: 1 } });
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    const err = new Promise<{ message: string }>((resolve) => host.once("ROOM_ERROR", resolve));
    host.emit("START_GAME");
    await expect(err).resolves.toMatchObject({ message: expect.any(String) });
  });

  it("catches up a reconnecting client with the current role selection", async () => {
    const host = await connect();
    const created = await new Promise<{ roomCode: string; playerId: string }>((resolve) => {
      host.on("ROOM_CREATED", resolve);
      host.emit("CREATE_ROOM", { pseudo: "Alice" });
    });

    const guest = await connect();
    const guestJoined = await new Promise<{ roomCode: string; playerId: string; reconnectToken: string }>(
      (resolve) => {
        guest.on("ROOM_JOINED", resolve);
        guest.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
      },
    );

    const guest2 = await connect();
    await new Promise<void>((resolve) => {
      host.once("PLAYER_LIST_UPDATE", (p) => {
        if (p.players.length === 3) resolve();
      });
      guest2.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Carl" });
    });

    host.emit("START_ROLE_SELECT");
    await new Promise<void>((resolve) => host.once("ROLE_SELECTION_UPDATE", () => resolve()));

    guest.close();
    await new Promise((r) => setTimeout(r, 200));

    const reattached = await connect({
      roomCode: guestJoined.roomCode,
      playerId: guestJoined.playerId,
      reconnectToken: guestJoined.reconnectToken,
    });
    const selectionOnReconnect = await new Promise<{ mode: string; roles: Record<string, number>; valid: boolean }>(
      (resolve) => reattached.on("ROLE_SELECTION_UPDATE", resolve),
    );

    expect(selectionOnReconnect.mode).toBe("classic");
    expect(selectionOnReconnect.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — no handlers registered for `START_ROLE_SELECT` etc., so the events above time out / never resolve.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/rooms/roleSelectEvents.ts`:

```ts
import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, GameMode, GameState, RoleCounts, ServerToClientEvents } from "@onuw/shared";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildClassicPreset,
  buildSimplePreset,
  isValidRoleId,
  validateRoleSelection,
} from "@onuw/shared";
import { withRoom } from "./roomStore.js";
import { transition } from "../state/phases.js";
import { assignRoles } from "../roles/presetValidation.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface Membership {
  roomCode: string;
  playerId: string;
}

export interface RoleSelectTickRunner {
  startNight: (roomCode: string) => Promise<void>;
}

const roleModeSchema = z.object({ mode: z.enum(["classic", "simple", "custom"]) });
// Plain string keys, not z.enum(ROLE_IDS): zod's record type inference over an
// enum key schema is exhaustive-by-construction (Record<RoleId, number>), which
// would reject the partial payloads every real SET_CUSTOM_ROLES call sends (a
// host only ever edits a handful of roles, not all 13). isValidRoleId is the
// same runtime guard `types.ts` already exports for exactly this purpose.
const roleCountsSchema = z
  .record(z.string(), z.number().int().min(0))
  .refine((roles) => Object.keys(roles).every((key) => isValidRoleId(key)), {
    message: "unknown role id in selection",
  });
const customRolesSchema = z.object({ roles: roleCountsSchema });

class NotHostError extends Error {}
class WrongPhaseError extends Error {}
class InvalidPlayerCountError extends Error {}
class InvalidSelectionError extends Error {}

function requireHost(room: GameState, playerId: string): void {
  const player = room.players.find((p) => p.id === playerId);
  if (!player?.isHost) throw new NotHostError();
}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotHostError) return "seul l'hôte peut faire cette action";
  if (err instanceof WrongPhaseError) return "action impossible dans la phase actuelle de la partie";
  if (err instanceof InvalidPlayerCountError) {
    return `le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}`;
  }
  if (err instanceof InvalidSelectionError) return "la sélection de rôles actuelle n'est pas valide";
  return "une erreur est survenue";
}

export function broadcastRoleSelection(io: AppServer, state: GameState): void {
  if (!state.roleSelection) return;
  const { valid } = validateRoleSelection(state.roleSelection.mode, state.players.length, state.roleSelection.roles);
  io.to(state.roomCode).emit("ROLE_SELECTION_UPDATE", {
    mode: state.roleSelection.mode,
    roles: state.roleSelection.roles,
    valid,
  });
}

export function registerRoleSelectEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
  tickRunner: RoleSelectTickRunner,
): void {
  socket.on("START_ROLE_SELECT", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "LOBBY") throw new WrongPhaseError();
          if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
            throw new InvalidPlayerCountError();
          }
          const mode: GameMode = "classic";
          const roles = buildClassicPreset(room.players.length);
          return { ...transition(room, "ROLE_SELECT"), roleSelection: { mode, roles }, updatedAt: Date.now() };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("SET_ROLE_MODE", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = roleModeSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "mode invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT") throw new WrongPhaseError();
          const mode = parsed.data.mode;
          const roles: RoleCounts =
            mode === "classic"
              ? buildClassicPreset(room.players.length)
              : mode === "simple"
                ? buildSimplePreset(room.players.length)
                : { ...(room.roleSelection?.roles ?? {}) };
          return { ...room, roleSelection: { mode, roles }, updatedAt: Date.now() };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("SET_CUSTOM_ROLES", (payload) => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      const parsed = customRolesSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit("ROOM_ERROR", { message: "sélection de rôles invalide" });
        return;
      }
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT" || room.roleSelection?.mode !== "custom") throw new WrongPhaseError();
          return {
            ...room,
            roleSelection: { mode: "custom" as const, roles: parsed.data.roles as RoleCounts },
            updatedAt: Date.now(),
          };
        });
        broadcastRoleSelection(io, state);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });

  socket.on("START_GAME", () => {
    void (async () => {
      const membership = getMembership();
      if (!membership) return;
      try {
        const state = await withRoom(membership.roomCode, (room) => {
          requireHost(room, membership.playerId);
          if (room.phase !== "ROLE_SELECT" || !room.roleSelection) throw new WrongPhaseError();
          const { valid } = validateRoleSelection(
            room.roleSelection.mode,
            room.players.length,
            room.roleSelection.roles,
          );
          if (!valid) throw new InvalidSelectionError();
          return assignRoles(room);
        });
        await tickRunner.startNight(state.roomCode);
      } catch (err) {
        socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
      }
    })();
  });
}
```

In `server/src/rooms/roomEvents.ts`:

1. Add two new import lines: `import { registerRoleSelectEvents, type Membership, type RoleSelectTickRunner } from "./roleSelectEvents.js";` and `import { validateRoleSelection } from "@onuw/shared";`. Keep this second one as its own statement — the file's existing `@onuw/shared` import (`import type { ClientToServerEvents, GameState, ServerToClientEvents } from "@onuw/shared";`) is a type-only import, and `validateRoleSelection` is a value, so it can't be folded into that line.
2. Change the function signature from `export function registerRoomEvents(io: AppServer, socket: AppSocket): void {` to:
   ```ts
   export function registerRoomEvents(io: AppServer, socket: AppSocket, tickRunner: RoleSelectTickRunner): void {
   ```
3. Change `let membership: { roomCode: string; playerId: string } | null = null;` to `let membership: Membership | null = null;`.
4. In the reconnect block (the `void (async () => { ... })()` right after the handshake-auth parsing), right after the existing `await broadcastRoster(io, state);` line, add:
   ```ts
   if (state.roleSelection) {
     const { valid } = validateRoleSelection(state.roleSelection.mode, state.players.length, state.roleSelection.roles);
     socket.emit("ROLE_SELECTION_UPDATE", {
       mode: state.roleSelection.mode,
       roles: state.roleSelection.roles,
       valid,
     });
   }
   ```
5. At the very end of `registerRoomEvents`, right before its closing `}`, add:
   ```ts
   registerRoleSelectEvents(io, socket, () => membership, tickRunner);
   ```

- [ ] **Step 4: Wire a stub tick runner into `index.ts`, then run tests**

`registerRoomEvents` now requires a `tickRunner` argument. Task 5 replaces it with the real `createTickRunner()` instance and wires `TICK_START` end-to-end; this task only needs enough to compile and to prove every handler except the actual night-launch. In `server/src/index.ts`, change the call inside the `io.on("connection", ...)` block from `registerRoomEvents(io, socket);` to:

```ts
registerRoomEvents(io, socket, { startNight: async () => {} });
```

In `server/src/rooms/roleSelectEvents.test.ts`, change the `"deals roles and starts the night sequence on START_GAME"` test from `it(` to `it.skip(` and add a one-line comment above it: `// un-skipped in Task 5, once index.ts wires the real TickRunner`.

Run: `npm run test -w server`
Expected: PASS, with that one test reported as skipped.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/roleSelectEvents.ts server/src/rooms/roleSelectEvents.test.ts server/src/rooms/roomEvents.ts server/src/index.ts
git commit -m "feat: add role-select socket handlers and reconnect catch-up"
```

---

## Task 5: Wire the Phase 1 `TickRunner` into the live app

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/rooms/roleSelectEvents.test.ts` — un-skip the test stubbed in Task 4

**Interfaces:**
- Consumes: `createTickRunner` (`./night/tickRunner.js`, already built in Phase 1)
- Produces: a live `tickRunner` instance passed into `registerRoomEvents`, replacing Task 4's stub.

- [ ] **Step 1: Write the failing test**

In `server/src/rooms/roleSelectEvents.test.ts`, remove the `it.skip` from `"deals roles and starts the night sequence on START_GAME"` (restore it to `it(`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — `TICK_START` never arrives, because `index.ts` still passes the no-op stub from Task 4.

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.ts`, add the import:

```ts
import { createTickRunner } from "./night/tickRunner.js";
```

Replace the body of `createApp()`:

```ts
export function createApp() {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { cors: { origin: "*" } },
  );
  const subClient = attachRedisAdapter(io);

  // TICK_START/TICK_PAYLOAD/NIGHT_END aren't in ServerToClientEvents yet (Phase 4
  // adds that typed contract, per the Phase 1 final-review prerequisite) — the
  // TickRunner's own deps intentionally stay string-typed until then.
  const tickRunner = createTickRunner({
    broadcast: (roomCode, event, payload) => {
      (io.to(roomCode) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
    emitToPlayer: (playerId, event, payload) => {
      (io.to(playerId) as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);
    },
  });

  io.on("connection", (socket) => {
    socket.emit("connected", { socketId: socket.id });
    registerRoomEvents(io, socket, tickRunner);
  });

  return { httpServer, io, subClient };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — the un-skipped test now receives a real `TICK_START` with `tickIndex: 0`.

- [ ] **Step 5: Run the full server suite to confirm nothing else broke**

Run: `npm run test -w server`
Expected: All server tests pass (the roster/reconnect tests from Phase 2 are unaffected — `registerRoomEvents` gained a parameter but its own behavior didn't change).

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts server/src/rooms/roleSelectEvents.test.ts
git commit -m "feat: wire the night TickRunner into createApp, closing the ROLE_SELECT -> NIGHT loop"
```

---

## Task 6: `client/src/roleLabels.ts` — French display names

**Files:**
- Create: `client/src/roleLabels.ts`
- Create: `client/src/roleLabels.test.ts`

**Interfaces:**
- Consumes: `ROLE_IDS`, `RoleId` from `@onuw/shared`
- Produces: `roleLabel(roleId: RoleId): string` — used by Task 7 (`RoleRecap.tsx`) and Task 9 (`RoleSelect.tsx`).

- [ ] **Step 1: Write the failing test**

Create `client/src/roleLabels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ROLE_IDS } from "@onuw/shared";
import { roleLabel } from "./roleLabels";

describe("roleLabel", () => {
  it("has a non-empty French label for every RoleId", () => {
    for (const id of ROLE_IDS) {
      expect(roleLabel(id).length).toBeGreaterThan(0);
    }
  });

  it("labels werewolf and seer as expected", () => {
    expect(roleLabel("werewolf")).toBe("Loup-Garou");
    expect(roleLabel("seer")).toBe("Voyante");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — `./roleLabels` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/roleLabels.ts`:

```ts
import type { RoleId } from "@onuw/shared";

const ROLE_LABELS: Record<RoleId, string> = {
  doppelganger: "Le Double",
  werewolf: "Loup-Garou",
  minion: "Sbire",
  mason: "Franc-Maçon",
  seer: "Voyante",
  robber: "Voleur",
  troublemaker: "Semeuse de troubles",
  drunk: "Ivrogne",
  insomniac: "Insomniaque",
  villager: "Villageois",
  hunter: "Chasseur",
  tanner: "Tanneur",
  villageIdiot: "Idiot du Village",
};

export function roleLabel(roleId: RoleId): string {
  return ROLE_LABELS[roleId];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/roleLabels.ts client/src/roleLabels.test.ts
git commit -m "feat: add French role display labels"
```

---

## Task 7: `client/src/components/RoleRecap.tsx` — the "visible to everyone" role summary

**Files:**
- Create: `client/src/components/RoleRecap.tsx`
- Create: `client/src/components/RoleRecap.test.tsx`

**Interfaces:**
- Consumes: `RoleCounts`, `ROLE_IDS` from `@onuw/shared`; `roleLabel` from `../roleLabels` (Task 6)
- Produces: `RoleRecap` component (`{ roles: RoleCounts }` props) — used by Task 9 (`RoleSelect.tsx`).

- [ ] **Step 1: Write the failing test**

Create `client/src/components/RoleRecap.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoleRecap from "./RoleRecap";

describe("RoleRecap", () => {
  it("lists each selected role with its count and label", () => {
    render(<RoleRecap roles={{ werewolf: 2, seer: 1, villager: 1 }} />);
    expect(screen.getByText("2 × Loup-Garou")).toBeInTheDocument();
    expect(screen.getByText("1 × Voyante")).toBeInTheDocument();
    expect(screen.getByText("1 × Villageois")).toBeInTheDocument();
  });

  it("omits roles with a zero or missing count", () => {
    render(<RoleRecap roles={{ werewolf: 2, seer: 0 }} />);
    expect(screen.queryByText(/Voyante/)).not.toBeInTheDocument();
  });

  it("shows a fallback message when nothing is selected", () => {
    render(<RoleRecap roles={{}} />);
    expect(screen.getByText(/aucun rôle/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — `./RoleRecap` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/components/RoleRecap.tsx`:

```tsx
import type { RoleCounts } from "@onuw/shared";
import { ROLE_IDS } from "@onuw/shared";
import { roleLabel } from "../roleLabels";

interface RoleRecapProps {
  roles: RoleCounts;
}

function RoleRecap({ roles }: RoleRecapProps) {
  const entries = ROLE_IDS.filter((id) => (roles[id] ?? 0) > 0);

  if (entries.length === 0) {
    return <p>Aucun rôle sélectionné</p>;
  }

  return (
    <ul>
      {entries.map((id) => (
        <li key={id}>
          {roles[id]} × {roleLabel(id)}
        </li>
      ))}
    </ul>
  );
}

export default RoleRecap;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RoleRecap.tsx client/src/components/RoleRecap.test.tsx
git commit -m "feat: add RoleRecap component showing the current role selection"
```

---

## Task 8: Extend `useRoomSocket` with role-select state and actions

**Files:**
- Modify: `client/src/hooks/useRoomSocket.ts`
- Modify: `client/src/hooks/useRoomSocket.test.ts`
- Modify: `client/src/pages/Home.test.tsx` (its `baseSession()` helper needs the new required `RoomSession` fields to typecheck)
- Modify: `client/src/App.test.tsx` (same reason)

**Interfaces:**
- Consumes: `GameMode`, `RoleCounts` from `@onuw/shared`
- Produces: `RoomSession.roleSelection: { mode: GameMode; roles: RoleCounts; valid: boolean } | null`; `startRoleSelect()`, `setRoleMode(mode)`, `setCustomRoles(roles)`, `startGame()` — used by Task 9 (`RoleSelect.tsx`) and Task 10 (`Lobby.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `client/src/hooks/useRoomSocket.test.ts`, after the existing `"surfaces ROOM_ERROR messages"` test:

```ts
  it("updates roleSelection on ROLE_SELECTION_UPDATE", () => {
    const { result } = renderHook(() => useRoomSocket());

    act(() => {
      mockSocket.trigger("ROLE_SELECTION_UPDATE", {
        mode: "classic",
        roles: { werewolf: 2, villager: 1 },
        valid: true,
      });
    });

    expect(result.current.roleSelection).toEqual({
      mode: "classic",
      roles: { werewolf: 2, villager: 1 },
      valid: true,
    });
  });

  it("emits START_ROLE_SELECT", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.startRoleSelect();
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("START_ROLE_SELECT");
  });

  it("emits SET_ROLE_MODE with the given mode", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.setRoleMode("simple");
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SET_ROLE_MODE", { mode: "simple" });
  });

  it("emits SET_CUSTOM_ROLES with the given roles", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.setCustomRoles({ werewolf: 2 });
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("SET_CUSTOM_ROLES", { roles: { werewolf: 2 } });
  });

  it("emits START_GAME", () => {
    const { result } = renderHook(() => useRoomSocket());
    act(() => {
      result.current.startGame();
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("START_GAME");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — `roleSelection`/`startRoleSelect`/etc. don't exist on the hook's return value yet.

- [ ] **Step 3: Write minimal implementation**

In `client/src/hooks/useRoomSocket.ts`:

Add to the type imports: `GameMode, RoleCounts,` (alongside the existing `ClientToServerEvents, PublicPlayer, ServerToClientEvents`).

Add a new type and extend `RoomSession`:

```ts
export interface RoleSelectionState {
  mode: GameMode;
  roles: RoleCounts;
  valid: boolean;
}

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
}
```

Inside `useRoomSocket()`, add the state:

```ts
const [roleSelection, setRoleSelectionState] = useState<RoleSelectionState | null>(null);
```

In the `useEffect` that registers socket listeners, add right after the existing `socket.on("PLAYER_LIST_UPDATE", ...)` line:

```ts
socket.on("ROLE_SELECTION_UPDATE", (payload) => setRoleSelectionState(payload));
```

After the existing `joinRoom` callback, add:

```ts
const startRoleSelect = useCallback(() => {
  socketRef.current?.emit("START_ROLE_SELECT");
}, []);

const setRoleMode = useCallback((mode: GameMode) => {
  socketRef.current?.emit("SET_ROLE_MODE", { mode });
}, []);

const setCustomRoles = useCallback((roles: RoleCounts) => {
  socketRef.current?.emit("SET_CUSTOM_ROLES", { roles });
}, []);

const startGame = useCallback(() => {
  socketRef.current?.emit("START_GAME");
}, []);
```

Update the final `return` statement:

```ts
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
};
```

In `client/src/pages/Home.test.tsx`, add the new fields to `baseSession()`:

```ts
function baseSession() {
  return {
    roomCode: "",
    playerId: "",
    players: [],
    roleSelection: null,
    error: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    startRoleSelect: vi.fn(),
    setRoleMode: vi.fn(),
    setCustomRoles: vi.fn(),
    startGame: vi.fn(),
  };
}
```

In `client/src/App.test.tsx`, add the same fields to the inline `mockReturnValue({...})` object (after `players: [],`, before `error: null,`):

```ts
      roleSelection: null,
```

and after `joinRoom: vi.fn(),`:

```ts
      startRoleSelect: vi.fn(),
      setRoleMode: vi.fn(),
      setCustomRoles: vi.fn(),
      startGame: vi.fn(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS (all client tests, including the untouched `Lobby.test.tsx` — it doesn't typecheck against `RoomSession` at the mock level the same strict way since `vi.mocked(...).mockReturnValue` infers from usage, but if it does start failing to typecheck here, that's expected and Task 10 fixes `Lobby.test.tsx`'s own mock next).

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useRoomSocket.ts client/src/hooks/useRoomSocket.test.ts client/src/pages/Home.test.tsx client/src/App.test.tsx
git commit -m "feat: add role-selection state and actions to useRoomSocket"
```

---

## Task 9: `client/src/pages/RoleSelect.tsx` — the role configuration screen

**Files:**
- Create: `client/src/pages/RoleSelect.tsx`
- Create: `client/src/pages/RoleSelect.test.tsx`

**Interfaces:**
- Consumes: `useRoomSocket` (Task 8), `RoleRecap` (Task 7), `roleLabel` (Task 6), `MIN_PLAYERS`/`MAX_PLAYERS`/`ROLE_IDS`/`totalRoleCount` from `@onuw/shared`
- Produces: `RoleSelect` default export — used by Task 11 (`App.tsx` routing).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/RoleSelect.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RoleSelect from "./RoleSelect";
import { useRoomSocket } from "../hooks/useRoomSocket";

vi.mock("../hooks/useRoomSocket", () => ({ useRoomSocket: vi.fn() }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode/roles" element={<RoleSelect />} />
      </Routes>
    </MemoryRouter>,
  );
}

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCDE",
    playerId: "p1",
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
    roleSelection: {
      mode: "classic",
      roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
      valid: true,
    },
    error: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    startRoleSelect: vi.fn(),
    setRoleMode: vi.fn(),
    setCustomRoles: vi.fn(),
    startGame: vi.fn(),
    ...overrides,
  };
}

describe("RoleSelect", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
  });

  it("shows a loading state while roleSelection hasn't arrived yet", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ roleSelection: null }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();
  });

  it("shows mode buttons to the host", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.getByRole("button", { name: /classique/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /simple/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /personnalisé/i })).toBeInTheDocument();
  });

  it("hides mode buttons and the launch button from non-host players", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ playerId: "p2" }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE/roles");
    expect(screen.queryByRole("button", { name: /classique/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });

  it("calls setRoleMode when the host clicks a mode button", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("button", { name: /personnalisé/i }));
    expect(session.setRoleMode).toHaveBeenCalledWith("custom");
  });

  it("shows the recap and the running total", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.getByText("2 × Loup-Garou")).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 6/)).toBeInTheDocument();
  });

  it("in custom mode, lets the host increment a role and calls setCustomRoles", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");

    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    expect(session.setCustomRoles).toHaveBeenCalled();
  });

  it("disables incrementing werewolf past 2", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const werewolfRow = screen.getByText("Loup-Garou").closest("li")!;
    const { getByRole } = within(werewolfRow);
    expect(getByRole("button", { name: "+" })).toBeDisabled();
  });

  it("disables incrementing insomniac when robber and troublemaker are both absent", () => {
    // total (4) is deliberately below target (6) so isFull is false — the button
    // must be disabled specifically because of the insomniac compat rule, not
    // because the selection happens to be full.
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 2 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const insomniacRow = screen.getByText("Insomniaque").closest("li")!;
    const { getByRole } = within(insomniacRow);
    expect(getByRole("button", { name: "+" })).toBeDisabled();
  });

  it("toggles mason straight between 0 and 2, never landing on 1", () => {
    const zero = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, mason: 0, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(zero as ReturnType<typeof useRoomSocket>);
    const { unmount } = renderAt("/room/ABCDE/roles");
    const masonRowZero = screen.getByText("Franc-Maçon").closest("li")!;
    fireEvent.click(within(masonRowZero).getByRole("button", { name: "+" }));
    expect(zero.setCustomRoles).toHaveBeenCalledWith({ werewolf: 2, mason: 2, villager: 1 });
    unmount();

    const two = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, mason: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(two as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    const masonRowTwo = screen.getByText("Franc-Maçon").closest("li")!;
    fireEvent.click(within(masonRowTwo).getByRole("button", { name: "-" }));
    expect(two.setCustomRoles).toHaveBeenCalledWith({ werewolf: 2, mason: 0, villager: 1 });
  });

  it("hides the role checklist from the host in classic mode", () => {
    renderAt("/room/ABCDE/roles");
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();
  });

  it("disables the launch button while the selection is invalid", () => {
    const session = baseSession({
      roleSelection: { mode: "custom", roles: { werewolf: 2, villager: 1 }, valid: false },
    });
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeDisabled();
  });

  it("calls startGame when the host clicks Lancer with a valid selection", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE/roles");
    fireEvent.click(screen.getByRole("button", { name: /lancer/i }));
    expect(session.startGame).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — `./RoleSelect` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/pages/RoleSelect.tsx`:

```tsx
import { useParams } from "react-router-dom";
import type { GameMode, RoleId } from "@onuw/shared";
import { ROLE_IDS, totalRoleCount } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoleRecap from "../components/RoleRecap";
import { roleLabel } from "../roleLabels";

const MODES: { id: GameMode; label: string }[] = [
  { id: "classic", label: "Classique" },
  { id: "simple", label: "Simple" },
  { id: "custom", label: "Personnalisé" },
];

const EDITABLE_ROLE_IDS = ROLE_IDS.filter((id) => id !== "villager");

function RoleSelect() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const { playerId, players, roleSelection, setRoleMode, setCustomRoles, startGame } = useRoomSocket();

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (!roleSelection) {
    return <p>Chargement de la configuration…</p>;
  }

  const { mode, roles, valid } = roleSelection;
  const playerCount = players.length;
  const total = totalRoleCount(roles);
  const target = playerCount + 3;
  const isFull = total >= target;

  function updateRole(roleId: RoleId, nextCount: number) {
    setCustomRoles({ ...roles, [roleId]: Math.max(0, nextCount) });
  }

  return (
    <div>
      <h1>Configuration des rôles — {routeRoomCode}</h1>

      {isHost && (
        <div>
          {MODES.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => setRoleMode(candidate.id)}
              aria-pressed={mode === candidate.id}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}

      {mode === "custom" && isHost && (
        <ul>
          {EDITABLE_ROLE_IDS.map((id) => {
            const count = roles[id] ?? 0;
            const isMason = id === "mason";
            const isWerewolf = id === "werewolf";
            const cap = isWerewolf || isMason ? 2 : 1;
            const atCap = count >= cap;
            const insomniacBlocked =
              id === "insomniac" && count === 0 && (roles.robber ?? 0) === 0 && (roles.troublemaker ?? 0) === 0;

            return (
              <li key={id}>
                <span>{roleLabel(id)}</span>
                <span>{count}</span>
                <button
                  aria-label="+"
                  onClick={() => updateRole(id, isMason ? 2 : count + 1)}
                  disabled={atCap || isFull || insomniacBlocked}
                >
                  +
                </button>
                <button aria-label="-" onClick={() => updateRole(id, isMason ? 0 : count - 1)} disabled={count === 0}>
                  -
                </button>
              </li>
            );
          })}
          <li>
            <span>{roleLabel("villager")}</span>
            <span>{roles.villager ?? 0}</span>
            <button
              aria-label="+"
              onClick={() => updateRole("villager", (roles.villager ?? 0) + 1)}
              disabled={isFull}
            >
              +
            </button>
            <button
              aria-label="-"
              onClick={() => updateRole("villager", (roles.villager ?? 0) - 1)}
              disabled={(roles.villager ?? 0) === 0}
            >
              -
            </button>
          </li>
        </ul>
      )}

      <p>
        {total} / {target} rôles sélectionnés
      </p>

      <RoleRecap roles={roles} />

      {isHost && (
        <button onClick={() => startGame()} disabled={!valid}>
          Lancer la partie
        </button>
      )}
    </div>
  );
}

export default RoleSelect;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RoleSelect.tsx client/src/pages/RoleSelect.test.tsx
git commit -m "feat: add RoleSelect page for Classique/Simple/Personnalisé role configuration"
```

---

## Task 10: Wire "Lancer la partie" into `Lobby.tsx`

**Files:**
- Modify: `client/src/pages/Lobby.tsx`
- Modify: `client/src/pages/Lobby.test.tsx`

**Interfaces:**
- Consumes: `startRoleSelect`, `roleSelection`, `playerId` from `useRoomSocket` (Task 8); `MIN_PLAYERS`/`MAX_PLAYERS` from `@onuw/shared`

- [ ] **Step 1: Write the failing test**

Replace the whole `client/src/pages/Lobby.test.tsx` file with:

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

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCDE",
    playerId: "p1",
    // 3 players by default (not 2, unlike Phase 2's fixture) so the Lancer button
    // is enabled out of the box — MIN_PLAYERS is 3; tests that care about the
    // below-minimum case override `players` explicitly.
    players: [
      { id: "p1", pseudo: "Alice", isHost: true, connected: true },
      { id: "p2", pseudo: "Bob", isHost: false, connected: true },
      { id: "p3", pseudo: "Carl", isHost: false, connected: true },
    ],
    roleSelection: null,
    error: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    startRoleSelect: vi.fn(),
    setRoleMode: vi.fn(),
    setCustomRoles: vi.fn(),
    startGame: vi.fn(),
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomCode" element={<Lobby />} />
        <Route path="/room/:roomCode/roles" element={<div>role-select-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Lobby", () => {
  beforeEach(() => {
    vi.mocked(useRoomSocket).mockReturnValue(baseSession() as ReturnType<typeof useRoomSocket>);
  });

  it("lists every player's pseudo", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByText(/^Alice/)).toBeInTheDocument();
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

  it("shows a Lancer button to the host when player count is in range", () => {
    renderAt("/room/ABCDE");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeEnabled();
  });

  it("hides the Lancer button from a non-host", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ playerId: "p2" }) as ReturnType<typeof useRoomSocket>,
    );
    renderAt("/room/ABCDE");
    expect(screen.queryByRole("button", { name: /lancer/i })).not.toBeInTheDocument();
  });

  it("disables the Lancer button when there are fewer than 3 players", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }] }) as ReturnType<
        typeof useRoomSocket
      >,
    );
    renderAt("/room/ABCDE");
    expect(screen.getByRole("button", { name: /lancer/i })).toBeDisabled();
  });

  it("calls startRoleSelect when the host clicks Lancer", () => {
    const session = baseSession();
    vi.mocked(useRoomSocket).mockReturnValue(session as ReturnType<typeof useRoomSocket>);
    renderAt("/room/ABCDE");
    screen.getByRole("button", { name: /lancer/i }).click();
    expect(session.startRoleSelect).toHaveBeenCalled();
  });

  it("navigates to the role-select page once roleSelection is set", () => {
    vi.mocked(useRoomSocket).mockReturnValue(
      baseSession({ roleSelection: { mode: "classic", roles: {}, valid: true } }) as ReturnType<
        typeof useRoomSocket
      >,
    );
    renderAt("/room/ABCDE");
    expect(screen.getByText("role-select-page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — no Lancer button rendered yet, no navigation on `roleSelection`.

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/pages/Lobby.tsx`:

```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MIN_PLAYERS, MAX_PLAYERS } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoomQrCode from "../components/RoomQrCode";

function Lobby() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, roleSelection, startRoleSelect } = useRoomSocket();

  useEffect(() => {
    if (roleSelection && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/roles`);
    }
  }, [roleSelection, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const canLaunch = players.length >= MIN_PLAYERS && players.length <= MAX_PLAYERS;

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
      {isHost && (
        <button onClick={() => startRoleSelect()} disabled={!canLaunch}>
          Lancer la partie
        </button>
      )}
    </div>
  );
}

export default Lobby;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Lobby.tsx client/src/pages/Lobby.test.tsx
git commit -m "feat: add Lancer button to Lobby, gated on player count, routing into role select"
```

---

## Task 11: Route `RoleSelect` in `App.tsx` and manual end-to-end check

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/App.test.tsx`
- Create (scratch, not committed): a manual smoke script exercising the real running server, same pattern as the Phase 2 close-out check

**Interfaces:**
- Consumes: `RoleSelect` (Task 9)

- [ ] **Step 1: Write the failing test**

Add to `client/src/App.test.tsx`, a second test after the existing one:

```tsx
  it("renders RoleSelect at /room/:roomCode/roles", () => {
    vi.mocked(useRoomSocket).mockReturnValue({
      roomCode: "",
      playerId: "p1",
      players: [{ id: "p1", pseudo: "Alice", isHost: true, connected: true }],
      roleSelection: { mode: "classic", roles: { werewolf: 2, villager: 1 }, valid: true },
      error: null,
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      startRoleSelect: vi.fn(),
      setRoleMode: vi.fn(),
      setCustomRoles: vi.fn(),
      startGame: vi.fn(),
    });
    window.history.pushState({}, "", "/room/ABCDE/roles");
    render(<App />);
    expect(screen.getByRole("heading", { name: /configuration des rôles/i })).toBeInTheDocument();
  });
```

(`App` uses `BrowserRouter`, not `MemoryRouter`, so route entry is via `window.history.pushState` before rendering — matches how `BrowserRouter` reads the current URL on mount.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client`
Expected: FAIL — no route for `/room/:roomCode/roles` yet.

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import RoleSelect from "./pages/RoleSelect";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Home />} />
        <Route path="/room/:roomCode" element={<Lobby />} />
        <Route path="/room/:roomCode/roles" element={<RoleSelect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client`
Expected: PASS

- [ ] **Step 5: Manual end-to-end smoke check**

Confirms the full round trip against the real running server (Redis + server + this script), the same way Phase 2 closed out — this is not a Vitest test, it's a standalone Node script hitting a live `npm run dev -w server` instance.

Start the server in one terminal: `npm run dev -w server` (requires `docker-compose up -d` for Redis first).

In another terminal, save this as a scratch file (e.g. `/tmp/onuw-phase3-smoke.mjs`) and run `node /tmp/onuw-phase3-smoke.mjs`:

```js
import { io } from "socket.io-client";

const URL = "http://localhost:3001";

function connect(auth = {}) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ["websocket"], auth });
    const t = setTimeout(() => reject(new Error("connect timeout")), 5000);
    s.on("connect", () => { clearTimeout(t); resolve(s); });
    s.on("connect_error", (e) => { clearTimeout(t); reject(e); });
  });
}

function once(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

async function main() {
  console.log("--- create a room with 3 players ---");
  const host = await connect();
  host.emit("CREATE_ROOM", { pseudo: "Alice" });
  const created = await once(host, "ROOM_CREATED");

  const bob = await connect();
  bob.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Bob" });
  await once(bob, "ROOM_JOINED");

  const carl = await connect();
  const rosterFull = once(host, "PLAYER_LIST_UPDATE");
  carl.emit("JOIN_ROOM", { roomCode: created.roomCode, pseudo: "Carl" });
  await rosterFull;

  console.log("--- host starts role select, expects the classic 3-player preset ---");
  const selectionUpdate = once(bob, "ROLE_SELECTION_UPDATE");
  host.emit("START_ROLE_SELECT");
  const selection = await selectionUpdate;
  console.log("ROLE_SELECTION_UPDATE:", selection);
  if (selection.mode !== "classic" || !selection.valid) throw new Error("expected a valid classic preset");
  if (JSON.stringify(selection.roles) !== JSON.stringify({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 })) {
    throw new Error(`unexpected preset: ${JSON.stringify(selection.roles)}`);
  }

  console.log("--- host switches to custom, sets an invalid then a valid selection ---");
  await once(host, "ROLE_SELECTION_UPDATE").catch(() => {});
  host.emit("SET_ROLE_MODE", { mode: "custom" });
  await once(host, "ROLE_SELECTION_UPDATE");
  const invalid = once(host, "ROLE_SELECTION_UPDATE");
  host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, villager: 1 } });
  const invalidResult = await invalid;
  if (invalidResult.valid) throw new Error("expected invalid (total != 6)");

  const valid = once(host, "ROLE_SELECTION_UPDATE");
  host.emit("SET_CUSTOM_ROLES", { roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 } });
  const validResult = await valid;
  if (!validResult.valid) throw new Error("expected valid (total == 6)");

  console.log("--- host launches, all three clients should see TICK_START tickIndex 0 ---");
  const tickPromises = [once(host, "TICK_START"), once(bob, "TICK_START"), once(carl, "TICK_START")];
  host.emit("START_GAME");
  const ticks = await Promise.all(tickPromises);
  for (const t of ticks) {
    if (t.tickIndex !== 0) throw new Error(`expected tickIndex 0, got ${t.tickIndex}`);
  }

  host.close(); bob.close(); carl.close();
  console.log("\n✅ ALL STEPS PASSED — role select, live recap, validation, and night launch verified against the real running server.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err.message);
  process.exit(1);
});
```

Expected output ends with `✅ ALL STEPS PASSED`. Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: route RoleSelect at /room/:roomCode/roles"
```

---

## Phase 3 close-out

After Task 11, run the whole-branch final review the same way Phase 1 and Phase 2 closed out: diff the full range of Phase 3 commits (first Task-1 commit through the Task-11 commit), address Important-severity findings before calling Phase 3 done, and record the result plus any deferred items or Phase-4-blocking prerequisites in `.superpowers/sdd/progress.md` (Phase 2's close-out review was never actually recorded there — do Phase 2 and Phase 3 together if the gap is still open when this phase finishes, don't let it compound into Phase 4).

Known item to carry forward regardless of review outcome: `TICK_START`/`TICK_PAYLOAD`/`TICK_PAUSED`/`TICK_RESUMED`/`NIGHT_END` are still untyped `string` events between `TickRunner` and Socket.io (Task 5 threads them through with an explicit cast, flagged inline). Phase 4's own prerequisite (already recorded in the Phase-breakdown doc) is to extend `ServerToClientEvents`/`ClientToServerEvents` with these before writing `Night.tsx` — Phase 3 does not attempt this since nothing in Phase 3 consumes those payloads yet.
