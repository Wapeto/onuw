import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Vote() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { players, revealResult, submitVote } = useRoomSocket();
  const [votedFor, setVotedFor] = useState<string | null>(null);

  useEffect(() => {
    if (revealResult && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/reveal`);
    }
  }, [revealResult, routeRoomCode, navigate]);

  return (
    <div>
      <h1>Vote — {routeRoomCode}</h1>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => {
                setVotedFor(p.id);
                submitVote(p.id);
              }}
              aria-pressed={votedFor === p.id}
            >
              {p.pseudo}
            </button>
          </li>
        ))}
      </ul>
      {votedFor && <p>Vote enregistré, en attente des autres joueurs…</p>}
    </div>
  );
}

export default Vote;
