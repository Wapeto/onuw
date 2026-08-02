import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoomSocket } from "../hooks/useRoomSocket";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Day() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { daySession, voteStarted } = useRoomSocket();
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
    return <p>En attente du début de la discussion…</p>;
  }

  return (
    <div>
      <h1>Discussion</h1>
      <p>{formatRemaining(remainingMs)}</p>
    </div>
  );
}

export default Day;
