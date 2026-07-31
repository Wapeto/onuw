import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Home() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { roomCode, error, createRoom, joinRoom } = useRoomSocket();
  const [pseudo, setPseudo] = useState("");
  const [joinCode, setJoinCode] = useState(code?.toUpperCase() ?? "");

  useEffect(() => {
    if (roomCode) navigate(`/room/${roomCode}`);
  }, [roomCode, navigate]);

  const trimmedPseudo = pseudo.trim();

  return (
    <div>
      <h1>One Night Ultimate Werewolf</h1>

      <label>
        Pseudo
        <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo" />
      </label>

      <button onClick={() => createRoom(trimmedPseudo)} disabled={trimmedPseudo.length === 0}>
        Créer une partie
      </button>

      <div>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Code de la room"
        />
        <button
          onClick={() => joinRoom(joinCode, trimmedPseudo)}
          disabled={trimmedPseudo.length === 0 || joinCode.trim().length === 0}
        >
          Rejoindre
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export default Home;
