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
  createdAt: number;
  updatedAt: number;
}

export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
}
