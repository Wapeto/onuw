import { describe, it, expect } from "vitest";
import type {
  GameState,
  NightState,
  Player,
  PublicPlayer,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./types";
import { ROLE_IDS, isValidRoleId } from "./types";

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
