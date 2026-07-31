export const ROLE_IDS = [
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
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

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

export type GameMode = "classic" | "simple" | "custom";

export type RoleCounts = Partial<Record<RoleId, number>>;

export interface RoleSelection {
  mode: GameMode;
  roles: RoleCounts;
}

export interface Player {
  id: string;
  pseudo: string;
  isHost: boolean;
  connected: boolean;
  reconnectToken: string;
  originalRoleId?: RoleId;
  currentRoleId?: RoleId;
}

export interface PublicPlayer {
  id: string;
  pseudo: string;
  isHost: boolean;
  connected: boolean | null;
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
  roleSelection: RoleSelection | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
  ROLE_SELECTION_UPDATE: (payload: { mode: GameMode; roles: RoleCounts; valid: boolean }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
}
