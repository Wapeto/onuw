import { useState } from "react";
import { useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function Vote() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const { players, voteResult, submitVote } = useRoomSocket();
  const [votedFor, setVotedFor] = useState<string | null>(null);

  if (voteResult) {
    return (
      <div>
        <h1>Résultat du vote — {routeRoomCode}</h1>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              {p.pseudo} — {voteResult.tally[p.id] ?? 0} voix
              {voteResult.eliminated.includes(p.id) ? " — éliminé" : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

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
