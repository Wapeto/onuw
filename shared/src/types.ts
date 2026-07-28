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
  originalRoleId?: RoleId;
  currentRoleId?: RoleId;
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
}

export interface ClientToServerEvents {
  ping: () => void;
}
