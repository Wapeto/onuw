import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import Screen from "../components/ui/Screen";
import Choice from "../components/ui/Choice";

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

  const votedName = players.find((p) => p.id === votedFor)?.pseudo;

  return (
    <Screen phase="vote">
      <header className="screen__head">
        <p className="eyebrow">Le vote</p>
        {/* Plain hyphen, not U+2011: Bodoni draws the non-breaking hyphen
            as a long dash, so "Loup‑Garou" read as "Loup−Garou". */}
        <h1 className="display screen__title">Qui est le Loup-Garou&nbsp;?</h1>
        <p className="screen__lede">
          À trois, tout le monde désigne. Ton choix reste modifiable jusqu'au dernier vote.
        </p>
      </header>

      <div className="screen__body stagger">
        <div className="choices">
          {players.map((p, i) => (
            <Choice
              key={p.id}
              index={i}
              label={p.pseudo}
              pressed={votedFor === p.id}
              onClick={() => {
                setVotedFor(p.id);
                submitVote(p.id);
              }}
            />
          ))}
        </div>
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        {votedFor ? (
          // Naming the target back is the confirmation — on a grid of eight
          // names a highlighted tile alone is easy to misread in the dark.
          <p className="hint">
            Vote enregistré pour {votedName}, en attente des autres joueurs…
          </p>
        ) : (
          <p className="hint">Touche un nom pour voter</p>
        )}
      </footer>
    </Screen>
  );
}

export default Vote;
