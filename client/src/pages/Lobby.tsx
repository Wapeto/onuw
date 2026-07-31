import { useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoomQrCode from "../components/RoomQrCode";

function Lobby() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const { players } = useRoomSocket();

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
    </div>
  );
}

export default Lobby;
