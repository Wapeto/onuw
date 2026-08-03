import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { roleLabel } from "../roleLabels";

const WINNING_TEAM_LABELS: Record<"village" | "werewolf" | "tanner", string> = {
  village: "Le Village gagne !",
  werewolf: "Les Loups-Garous gagnent !",
  tanner: "Le Tanneur gagne, seul !",
};

function Reveal() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, roleSelection, revealResult, replay } = useRoomSocket();

  useEffect(() => {
    if (roleSelection && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/roles`);
    }
  }, [roleSelection, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (!revealResult) {
    return <p>En attente du résultat…</p>;
  }

  return (
    <div>
      <h1>Révélation — {routeRoomCode}</h1>
      <p>{WINNING_TEAM_LABELS[revealResult.winningTeam]}</p>
      <ul>
        {revealResult.players.map((p) => (
          <li key={p.id}>
            {p.pseudo} — {roleLabel(p.originalRoleId)}
            {p.originalRoleId !== p.currentRoleId ? ` → ${roleLabel(p.currentRoleId)}` : ""}
            {revealResult.eliminated.includes(p.id) ? " — éliminé" : ""}
            {revealResult.winners.includes(p.id) ? " 🏆" : ""}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button onClick={() => replay()}>Rejouer</button>
      ) : (
        <p>En attente de l'hôte pour rejouer…</p>
      )}
    </div>
  );
}

export default Reveal;
