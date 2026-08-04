import { useEffect, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import { roleLabel } from "../roleLabels";
import Screen from "../components/ui/Screen";
import Waiting from "../components/ui/Waiting";

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
    return <Waiting phase="reveal">En attente du résultat…</Waiting>;
  }

  const { winningTeam, winners, eliminated, tally } = revealResult;
  const iWon = winners.includes(playerId);

  return (
    <Screen phase="reveal" team={winningTeam}>
      <header className="screen__head">
        <p className="eyebrow">Révélation</p>
        <h1 className="outcome" data-team={winningTeam}>
          {WINNING_TEAM_LABELS[winningTeam]}
        </h1>
        {/* Personal outcome first: "did I win?" is the only question anyone
            has in the second after the reveal lands. */}
        <p className="screen__lede">
          {iWon ? "Tu fais partie des gagnants." : "Ce n'était pas ta nuit."}
        </p>
      </header>

      <div className="screen__body">
        <ul className="verdicts">
          {revealResult.players.map((p, i) => {
            const swapped = p.originalRoleId !== p.currentRoleId;
            const isOut = eliminated.includes(p.id);
            const won = winners.includes(p.id);

            return (
              <li
                key={p.id}
                className="verdict"
                data-eliminated={isOut}
                data-winner={won}
                style={{ animationDelay: `${i * 60}ms` } as CSSProperties}
              >
                <span className="verdict__name">{p.pseudo}</span>
                <span className="verdict__votes">
                  {tally[p.id] ?? 0} voix
                </span>
                <span className="verdict__roles">
                  {/* When a card was swapped in the night, the original is
                      struck through and the final role is the coloured one —
                      the swap is the story of the whole game. */}
                  <span className="verdict__role" data-swapped={swapped}>
                    {roleLabel(p.originalRoleId)}
                  </span>
                  {swapped && (
                    <>
                      <span className="verdict__arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="verdict__role verdict__role--final">
                        {roleLabel(p.currentRoleId)}
                      </span>
                    </>
                  )}
                  {isOut && <span className="verdict__tag">éliminé</span>}
                  {won && <span className="verdict__tag verdict__tag--winner">gagnant</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        {isHost ? (
          <button type="button" className="btn btn--primary btn--block" onClick={() => replay()}>
            Rejouer
          </button>
        ) : (
          <p className="hint">En attente de l'hôte pour rejouer…</p>
        )}
      </footer>
    </Screen>
  );
}

export default Reveal;
