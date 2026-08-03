import { describe, it, expect } from "vitest";
import type {
  GameState,
  NightState,
  Player,
  PublicPlayer,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./types";
import { ROLE_IDS, isValidRoleId, NIGHT_TICK_IDS, DEFAULT_DAY_DURATION_MS, MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "./types";

describe("isValidRoleId", () => {
  it("pins the total number of roles", () => {
    expect(ROLE_IDS).toHaveLength(13);
  });

  it("accepts every id in ROLE_IDS", () => {
    for (const id of ROLE_IDS) {
      expect(isValidRoleId(id)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isValidRoleId("wizard")).toBe(false);
  });
});

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
      reconnectToken: "token1",
      originalRoleId: "seer",
      currentRoleId: "seer",
    };
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

    expect(state.night?.tickIndex).toBe(2);
    expect(state.players[0].currentRoleId).toBe("seer");
  });
});

describe("lobby event contracts", () => {
  it("PublicPlayer never carries role fields, and allows a masked connected state", () => {
    const visible: PublicPlayer = {
      id: "p1",
      pseudo: "Alice",
      isHost: true,
      connected: true,
    };
    const masked: PublicPlayer = {
      id: "p2",
      pseudo: "Bob",
      isHost: false,
      connected: null,
    };

    expect(visible.connected).toBe(true);
    expect(masked.connected).toBeNull();
    // @ts-expect-error PublicPlayer must not expose role fields
    expect(visible.originalRoleId).toBeUndefined();
  });

  it("wires CREATE_ROOM/JOIN_ROOM and their server responses", () => {
    const clientEvents: ClientToServerEvents = {
      ping: () => {},
      CREATE_ROOM: () => {},
      JOIN_ROOM: () => {},
    };
    const serverEvents: ServerToClientEvents = {
      connected: () => {},
      ROOM_CREATED: () => {},
      ROOM_JOINED: () => {},
      PLAYER_LIST_UPDATE: () => {},
      ROOM_ERROR: () => {},
    };

    expect(typeof clientEvents.CREATE_ROOM).toBe("function");
    expect(typeof serverEvents.PLAYER_LIST_UPDATE).toBe("function");
  });
});

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
      reveal: { eliminated: ["p1"], winningTeam: "village", winners: ["p2", "p3"], tally: { p1: 2 } },
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
      tally: { p1: 2 },
      players: [{ id: "p1", pseudo: "Alice", originalRoleId: "villager", currentRoleId: "villager" }],
    });
    expect(typeof clientEvents.REPLAY).toBe("function");
  });
});
