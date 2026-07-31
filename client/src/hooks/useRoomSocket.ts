import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameMode,
  PublicPlayer,
  RoleCounts,
  ServerToClientEvents,
} from "@onuw/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const STORAGE_ROOM_CODE = "onuw:roomCode";
const STORAGE_PLAYER_ID = "onuw:playerId";
const STORAGE_RECONNECT_TOKEN = "onuw:reconnectToken";

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

function readStoredSession(): { roomCode: string; playerId: string; reconnectToken: string } {
  return {
    roomCode: sessionStorage.getItem(STORAGE_ROOM_CODE) ?? "",
    playerId: sessionStorage.getItem(STORAGE_PLAYER_ID) ?? "",
    reconnectToken: sessionStorage.getItem(STORAGE_RECONNECT_TOKEN) ?? "",
  };
}

function storeSession(roomCode: string, playerId: string, reconnectToken: string): void {
  sessionStorage.setItem(STORAGE_ROOM_CODE, roomCode);
  sessionStorage.setItem(STORAGE_PLAYER_ID, playerId);
  sessionStorage.setItem(STORAGE_RECONNECT_TOKEN, reconnectToken);
}

export function useRoomSocket(): RoomSession {
  const socketRef = useRef<AppSocket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [roleSelection, setRoleSelectionState] = useState<RoleSelectionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredSession();
    const socket: AppSocket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: stored.roomCode && stored.playerId && stored.reconnectToken ? stored : {},
    });
    socketRef.current = socket;

    socket.on("ROOM_CREATED", (payload) => {
      storeSession(payload.roomCode, payload.playerId, payload.reconnectToken);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("ROOM_JOINED", (payload) => {
      storeSession(payload.roomCode, payload.playerId, payload.reconnectToken);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("PLAYER_LIST_UPDATE", (payload) => setPlayers(payload.players));
    socket.on("ROLE_SELECTION_UPDATE", (payload) => setRoleSelectionState(payload));
    socket.on("ROOM_ERROR", (payload) => setError(payload.message));

    return () => {
      socket.close();
    };
  }, []);

  const createRoom = useCallback((pseudo: string) => {
    socketRef.current?.emit("CREATE_ROOM", { pseudo });
  }, []);

  const joinRoom = useCallback((roomCode: string, pseudo: string) => {
    socketRef.current?.emit("JOIN_ROOM", { roomCode, pseudo });
  }, []);

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
}
