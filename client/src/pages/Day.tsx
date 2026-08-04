import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";
import Screen from "../components/ui/Screen";
import Waiting from "../components/ui/Waiting";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Urgency is deliberately carried by three redundant channels at once —
 * ring colour, numeral colour, and a pulse — because this clock is read
 * from across a dark room, at an angle, mid-argument.
 */
function urgencyOf(remainingMs: number): "calm" | "warn" | "critical" {
  if (remainingMs <= 30_000) return "critical";
  if (remainingMs <= 60_000) return "warn";
  return "calm";
}

function Day() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, daySession, voteStarted, skipDay } = useRoomSocket();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!daySession) return;
    setRemainingMs(daySession.durationMs);
    const interval = setInterval(() => {
      setRemainingMs((prev) => (prev !== null ? Math.max(prev - 1000, 0) : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [daySession]);

  useEffect(() => {
    if (voteStarted && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/vote`);
    }
  }, [voteStarted, routeRoomCode, navigate]);

  if (remainingMs === null) {
    return <Waiting phase="day">En attente du début de la discussion…</Waiting>;
  }

  const totalMs = daySession?.durationMs ?? 1;
  const progress = totalMs > 0 ? Math.max(remainingMs / totalMs, 0) : 0;
  const isHost = players.find((p) => p.id === playerId)?.isHost ?? false;

  return (
    <Screen phase="day" align="center">
      <header className="screen__head" style={{ textAlign: "center", alignItems: "center" }}>
        <p className="eyebrow">Le jour se lève</p>
        <h1 className="display screen__title">Discussion</h1>
      </header>

      <div className="screen__body">
        <div className="timer" data-urgency={urgencyOf(remainingMs)} style={{ "--progress": progress } as CSSProperties}>
          <span className="timer__value">{formatRemaining(remainingMs)}</span>
        </div>
        <p className="timer__caption">
          {remainingMs === 0 ? "Temps écoulé" : "Avant le vote"}
        </p>
      </div>

      <div className="screen__spacer" />

      {/* A table that has said everything it has to say should not have to
          watch a clock run down. Host-only, like every other action that
          moves the whole room forward. */}
      <footer className="screen__foot">
        {isHost ? (
          <>
            <button type="button" className="btn btn--primary btn--block" onClick={() => skipDay()}>
              Passer au vote
            </button>
            <p className="hint">Tout le monde vote immédiatement.</p>
          </>
        ) : (
          <p className="hint">L'hôte peut lancer le vote plus tôt.</p>
        )}
      </footer>
    </Screen>
  );
}

export default Day;
