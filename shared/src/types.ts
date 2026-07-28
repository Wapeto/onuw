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
