import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PublicPlayer, ServerToClientEvents } from "@onuw/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const STORAGE_ROOM_CODE = "onuw:roomCode";
const STORAGE_PLAYER_ID = "onuw:playerId";

export interface RoomSession {
  roomCode: string;
  playerId: string;
  players: PublicPlayer[];
  error: string | null;
  createRoom: (pseudo: string) => void;
  joinRoom: (roomCode: string, pseudo: string) => void;
}

function readStoredSession(): { roomCode: string; playerId: string } {
  return {
    roomCode: sessionStorage.getItem(STORAGE_ROOM_CODE) ?? "",
    playerId: sessionStorage.getItem(STORAGE_PLAYER_ID) ?? "",
  };
}

function storeSession(roomCode: string, playerId: string): void {
  sessionStorage.setItem(STORAGE_ROOM_CODE, roomCode);
  sessionStorage.setItem(STORAGE_PLAYER_ID, playerId);
}

export function useRoomSocket(): RoomSession {
  const socketRef = useRef<AppSocket | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredSession();
    const socket: AppSocket = io(SOCKET_URL, {
      transports: ["websocket"],
      auth: stored.roomCode && stored.playerId ? stored : {},
    });
    socketRef.current = socket;

    socket.on("ROOM_CREATED", (payload) => {
      storeSession(payload.roomCode, payload.playerId);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("ROOM_JOINED", (payload) => {
      storeSession(payload.roomCode, payload.playerId);
      setRoomCode(payload.roomCode);
      setPlayerId(payload.playerId);
      setError(null);
    });
    socket.on("PLAYER_LIST_UPDATE", (payload) => setPlayers(payload.players));
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

  return { roomCode, playerId, players, error, createRoom, joinRoom };
}
