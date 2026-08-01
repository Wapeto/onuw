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

export const NIGHT_TICK_IDS = [
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
] as const;

export type NightTickId = (typeof NIGHT_TICK_IDS)[number];

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
  resolvedActions?: Record<string, number>;
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
  TICK_START: (payload: { tickIndex: number; tickId: NightTickId; durationMs: number }) => void;
  TICK_PAYLOAD: (payload: { tickId: NightTickId; active: boolean }) => void;
  TICK_PAUSED: (payload: Record<string, never>) => void;
  TICK_RESUMED: (payload: { remainingMs: number }) => void;
  NIGHT_END: (payload: Record<string, never>) => void;
  ACTION_RESULT: (payload: { tickId: NightTickId; result: unknown }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
  SUBMIT_NIGHT_ACTION: (payload: { tickId: NightTickId; params: Record<string, unknown> }) => void;
}
