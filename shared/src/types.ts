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
  | "ROLE_REVEAL"
  | "NIGHT"
  | "DAY"
  | "VOTE"
  | "REVEAL";

export type GameMode = "classic" | "simple" | "custom";

export const DEFAULT_DAY_DURATION_MS = 4 * 60 * 1000;
export const MIN_DAY_DURATION_MS = 60 * 1000;
export const MAX_DAY_DURATION_MS = 10 * 60 * 1000;

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
  resolvedActions?: Record<string, { phase1?: boolean; phase2?: boolean }>;
  graceUntil?: number;
  graceForPlayerId?: string;
}

export interface DayState {
  startedAt: number;
  durationMs: number;
}

/**
 * The briefing that sits between the deal and the first night tick.
 *
 * Playtesting showed the night was unreadable without it: cards were dealt
 * and the first tick armed in the same instant, so a player never found out
 * what they were holding, let alone what they were supposed to do with it.
 * The night now waits here until everyone says they've read their card.
 */
export interface RoleRevealState {
  readyPlayerIds: string[];
}

export interface VoteState {
  votes: Record<string, string>;
}

export type WinningTeam = "village" | "werewolf" | "tanner";

export interface RevealState {
  eliminated: string[];
  winningTeam: WinningTeam;
  winners: string[];
  tally: Record<string, number>;
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

export interface GameState {
  roomCode: string;
  phase: RoomPhase;
  players: Player[];
  center: RoleId[];
  roleReveal: RoleRevealState | null;
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

export interface ServerToClientEvents {
  connected: (payload: { socketId: string }) => void;
  ROOM_CREATED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  ROOM_JOINED: (payload: { roomCode: string; playerId: string; reconnectToken: string }) => void;
  PLAYER_LIST_UPDATE: (payload: { players: PublicPlayer[] }) => void;
  ROOM_ERROR: (payload: { message: string }) => void;
  ROLE_SELECTION_UPDATE: (payload: { mode: GameMode; roles: RoleCounts; valid: boolean }) => void;
  /**
   * Sent to one player only, on their own socket: the card they were dealt.
   * `rolesInPlay` is the whole deck (players + centre) and is public
   * knowledge in One Night — it's what the table agreed to play with.
   */
  YOUR_ROLE: (payload: { roleId: RoleId; rolesInPlay: RoleCounts; wakesAtNight: boolean }) => void;
  ROLE_REVEAL_UPDATE: (payload: { readyPlayerIds: string[]; totalPlayers: number }) => void;
  TICK_START: (payload: {
    tickIndex: number;
    tickId: NightTickId;
    durationMs: number;
    tickNumber: number;
    tickCount: number;
  }) => void;
  TICK_PAYLOAD: (payload: { tickId: NightTickId; active: boolean }) => void;
  TICK_PAUSED: (payload: Record<string, never>) => void;
  TICK_RESUMED: (payload: { remainingMs: number }) => void;
  NIGHT_END: (payload: Record<string, never>) => void;
  ACTION_RESULT: (payload: { tickId: NightTickId; result: unknown }) => void;
  DAY_DURATION_UPDATE: (payload: { durationMs: number }) => void;
  DAY_START: (payload: { durationMs: number }) => void;
  VOTE_START: (payload: Record<string, never>) => void;
  VOTE_RESULT: (payload: { tally: Record<string, number>; eliminated: string[] }) => void;
  REVEAL_RESULT: (payload: RevealPayload) => void;
}

export interface ClientToServerEvents {
  ping: () => void;
  CREATE_ROOM: (payload: { pseudo: string }) => void;
  JOIN_ROOM: (payload: { roomCode: string; pseudo: string }) => void;
  START_ROLE_SELECT: () => void;
  SET_ROLE_MODE: (payload: { mode: GameMode }) => void;
  SET_CUSTOM_ROLES: (payload: { roles: RoleCounts }) => void;
  START_GAME: () => void;
  READY_FOR_NIGHT: () => void;
  /** Host escape hatch: start the night without waiting on every "prêt". */
  START_NIGHT: () => void;
  SUBMIT_NIGHT_ACTION: (payload: { tickId: NightTickId; params: Record<string, unknown> }) => void;
  SET_DAY_DURATION: (payload: { durationMs: number }) => void;
  /** Host cuts the discussion short and sends the table straight to the vote. */
  SKIP_DAY: () => void;
  SUBMIT_VOTE: (payload: { targetPlayerId: string }) => void;
  REPLAY: () => void;
}
