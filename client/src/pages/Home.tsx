import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import Screen from "../components/ui/Screen";

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
  const hasPseudo = trimmedPseudo.length > 0;
  const hasCode = joinCode.trim().length > 0;
  // Arriving on /join/:code (a QR scan or a shared link) already states the
  // intent, so that path takes the primary button and "Créer" steps back.
  // Everyone but the host reaches the game this way.
  const arrivedViaLink = Boolean(code);

  return (
    <Screen phase="lobby">
      <header className="screen__head">
        <p className="eyebrow">Une partie, une nuit</p>
        <h1 className="display screen__title screen__title--hero">
          One Night <em>Ultimate</em> Werewolf
        </h1>
      </header>

      <div className="screen__body stagger">
        <div className="field">
          <label className="field__label" htmlFor="pseudo">
            Pseudo
          </label>
          <input
            id="pseudo"
            className="input"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            placeholder="Ton pseudo"
            autoComplete="nickname"
            enterKeyHint="done"
            maxLength={20}
          />
        </div>

        <div className="panel stack">
          <p className="panel__title">Rejoindre une partie</p>
          <div className="field">
            <label className="field__label" htmlFor="join-code">
              Code de la room
            </label>
            <input
              id="join-code"
              className="input input--code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              // The code is read off someone else's screen or shouted across a
              // table — autocorrect and spellcheck both fight that.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={8}
            />
          </div>
          <button
            type="button"
            className={`btn btn--block ${arrivedViaLink ? "btn--primary" : "btn--ghost"}`}
            onClick={() => joinRoom(joinCode, trimmedPseudo)}
            disabled={!hasPseudo || !hasCode}
          >
            Rejoindre
          </button>
        </div>

        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        <button
          type="button"
          className={`btn btn--block ${arrivedViaLink ? "btn--ghost" : "btn--primary"}`}
          onClick={() => createRoom(trimmedPseudo)}
          disabled={!hasPseudo}
        >
          Créer une partie
        </button>
        <p className="hint">
          {hasPseudo ? "3 à 10 joueurs · un téléphone chacun" : "Entre un pseudo pour commencer"}
        </p>
      </footer>
    </Screen>
  );
}

export default Home;
