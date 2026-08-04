import { useEffect, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MIN_PLAYERS, MAX_PLAYERS } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoomQrCode from "../components/RoomQrCode";
import Screen from "../components/ui/Screen";

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
  const count = players.length;
  const canLaunch = count >= MIN_PLAYERS && count <= MAX_PLAYERS;

  // Spelled out rather than left to a disabled button, because "why can't I
  // start?" is the single most common question in a lobby.
  const launchHint =
    count < MIN_PLAYERS
      ? `Encore ${MIN_PLAYERS - count} joueur${MIN_PLAYERS - count > 1 ? "s" : ""} pour commencer`
      : count > MAX_PLAYERS
        ? `${MAX_PLAYERS} joueurs maximum`
        : "Tout le monde est là ?";

  return (
    <Screen phase="lobby">
      <header className="screen__head">
        <p className="eyebrow">Salle d'attente</p>
        <div className="roomcode">
          <span className="roomcode__label">Code de la partie</span>
          <strong className="roomcode__value">{routeRoomCode}</strong>
        </div>
      </header>

      <div className="screen__body stagger">
        <RoomQrCode roomCode={routeRoomCode ?? ""} />
        <p className="hint">Scanne pour rejoindre, ou tape le code ci-dessus</p>

        <div className="stack--tight stack">
          <div className="tally">
            <span className="panel__title" style={{ marginBottom: 0 }}>
              Joueurs
            </span>
            <span className="roster__count">
              {count} / {MAX_PLAYERS}
            </span>
          </div>
          <ul className="roster">
            {players.map((p, i) => (
              <li
                key={p.id}
                className="roster__row"
                style={{ "--i": i, animationDelay: `${i * 55}ms` } as CSSProperties}
              >
                <span className="roster__name">{p.pseudo}</span>
                {p.isHost && <span className="roster__host">hôte</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="screen__spacer" />

      {isHost ? (
        <footer className="screen__foot">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => startRoleSelect()}
            disabled={!canLaunch}
          >
            Lancer la partie
          </button>
          <p className="hint">{launchHint}</p>
        </footer>
      ) : (
        <footer className="screen__foot">
          <p className="hint">En attente de l'hôte pour lancer la partie…</p>
        </footer>
      )}
    </Screen>
  );
}

export default Lobby;
