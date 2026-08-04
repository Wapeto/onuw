import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import Screen from "../components/ui/Screen";
import Waiting from "../components/ui/Waiting";
import RoleRecap from "../components/RoleRecap";
import { roleLabel } from "../roleLabels";
import { roleInfo, TEAM_LABELS } from "../roleInfo";

/**
 * The briefing between the deal and the first tick.
 *
 * Before this screen existed the night began in the same instant the cards
 * were dealt, and the first playtest found the result unplayable: nobody
 * knew what they were holding, what they were about to be asked, or what
 * counted as winning for them. Everything a player needs to survive the
 * night is on this one screen, and the night does not start until they say
 * they've read it.
 */
function RoleReveal() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, myRole, roleRevealProgress, readyForNight, startNight, currentTick } = useRoomSocket();

  useEffect(() => {
    if (currentTick && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/night`);
    }
  }, [currentTick, routeRoomCode, navigate]);

  if (!myRole) return <Waiting phase="night">Distribution des cartes…</Waiting>;

  const info = roleInfo(myRole.roleId);
  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const isReady = roleRevealProgress?.readyPlayerIds.includes(playerId) ?? false;
  const readyCount = roleRevealProgress?.readyPlayerIds.length ?? 0;
  const totalPlayers = roleRevealProgress?.totalPlayers ?? players.length;

  return (
    <Screen phase="night">
      <header className="screen__head">
        <p className="eyebrow">Ta carte · garde l'écran pour toi</p>
        {/* The role name is the largest thing on the page by a wide margin:
            it is the one fact a player must still have in mind twenty
            minutes later, when the night is long over. */}
        <h1 className="display screen__title">{roleLabel(myRole.roleId)}</h1>
        <p className="screen__lede">
          <span className="chip" data-team={info.team}>
            {TEAM_LABELS[info.team]}
          </span>
        </p>
      </header>

      <div className="screen__body stagger">
        <div className="panel">
          <p className="panel__title">Comment tu gagnes</p>
          <p>{info.goal}</p>
        </div>

        <div className="panel">
          <p className="panel__title">{myRole.wakesAtNight ? "Cette nuit" : "Cette nuit, tu dors"}</p>
          <p>{info.night}</p>
          {myRole.wakesAtNight && (
            <p className="hint">
              Ton tour arrivera pendant la nuit. Tu n'auras que quelques secondes : sache déjà quoi faire.
            </p>
          )}
        </div>

        <div className="panel">
          <p className="panel__title">Pendant la discussion</p>
          <p>{info.tip}</p>
        </div>

        <div className="panel">
          <p className="panel__title">Les {totalPlayers + 3} cartes en jeu</p>
          {/* Public knowledge — the table chose this deck together — and
              essential context: knowing the Sbire is in the box changes how
              you read every claim made during the day. */}
          <RoleRecap roles={myRole.rolesInPlay} />
          <p className="hint">3 de ces cartes sont au centre, face cachée.</p>
        </div>
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        {isReady ? (
          <>
            <p className="waiting">
              {readyCount} / {totalPlayers} prêts
            </p>
            {isHost && (
              <button type="button" className="btn btn--primary btn--block" onClick={() => startNight()}>
                Commencer la nuit maintenant
              </button>
            )}
            <p className="hint">
              {isHost
                ? "La nuit démarre seule dès que tout le monde est prêt."
                : "La nuit démarre dès que tout le monde est prêt."}
            </p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--block" onClick={() => readyForNight()}>
              J'ai compris mon rôle
            </button>
            <p className="hint">
              Prends ton temps : la nuit ne commencera pas avant que tout le monde ait lu sa carte.
            </p>
          </>
        )}
      </footer>
    </Screen>
  );
}

export default RoleReveal;
