import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MIN_PLAYERS, MAX_PLAYERS } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoomQrCode from "../components/RoomQrCode";

function Lobby() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, roleSelection, startRoleSelect } = useRoomSocket();

  useEffect(() => {
    if (roleSelection && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/roles`);
    }
  }, [roleSelection, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const canLaunch = players.length >= MIN_PLAYERS && players.length <= MAX_PLAYERS;

  return (
    <div>
      <h1>Room {routeRoomCode}</h1>
      <RoomQrCode roomCode={routeRoomCode ?? ""} />
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            {p.pseudo}
            {p.isHost ? " (hôte)" : ""}
          </li>
        ))}
      </ul>
      {isHost && (
        <button onClick={() => startRoleSelect()} disabled={!canLaunch}>
          Lancer la partie
        </button>
      )}
    </div>
  );
}

export default Lobby;
