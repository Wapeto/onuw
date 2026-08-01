import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { GameMode, RoleId } from "@onuw/shared";
import { ROLE_IDS, totalRoleCount } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoleRecap from "../components/RoleRecap";
import { roleLabel } from "../roleLabels";

const MODES: { id: GameMode; label: string }[] = [
  { id: "classic", label: "Classique" },
  { id: "simple", label: "Simple" },
  { id: "custom", label: "Personnalisé" },
];

const EDITABLE_ROLE_IDS = ROLE_IDS.filter((id) => id !== "villager");

function RoleSelect() {
  const { roomCode: routeRoomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { playerId, players, roleSelection, currentTick, setRoleMode, setCustomRoles, startGame } = useRoomSocket();

  useEffect(() => {
    if (currentTick && routeRoomCode) {
      navigate(`/room/${routeRoomCode}/night`);
    }
  }, [currentTick, routeRoomCode, navigate]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (!roleSelection) {
    return <p>Chargement de la configuration…</p>;
  }

  const { mode, roles, valid } = roleSelection;
  const playerCount = players.length;
  const total = totalRoleCount(roles);
  const target = playerCount + 3;
  const isFull = total >= target;

  function updateRole(roleId: RoleId, nextCount: number) {
    setCustomRoles({ ...roles, [roleId]: Math.max(0, nextCount) });
  }

  return (
    <div>
      <h1>Configuration des rôles — {routeRoomCode}</h1>

      {isHost && (
        <div>
          {MODES.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => setRoleMode(candidate.id)}
              aria-pressed={mode === candidate.id}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}

      {mode === "custom" && isHost && (
        <ul>
          {EDITABLE_ROLE_IDS.map((id) => {
            const count = roles[id] ?? 0;
            const isMason = id === "mason";
            const isWerewolf = id === "werewolf";
            const cap = isWerewolf || isMason ? 2 : 1;
            const atCap = count >= cap;
            const insomniacBlocked =
              id === "insomniac" && count === 0 && (roles.robber ?? 0) === 0 && (roles.troublemaker ?? 0) === 0;

            return (
              <li key={id}>
                <span>{roleLabel(id)}</span>
                <span>{count}</span>
                <button
                  aria-label="+"
                  onClick={() => updateRole(id, isMason ? 2 : count + 1)}
                  disabled={atCap || isFull || insomniacBlocked}
                >
                  +
                </button>
                <button aria-label="-" onClick={() => updateRole(id, isMason ? 0 : count - 1)} disabled={count === 0}>
                  -
                </button>
              </li>
            );
          })}
          <li>
            <span>{roleLabel("villager")}</span>
            <span>{roles.villager ?? 0}</span>
            <button
              aria-label="+"
              onClick={() => updateRole("villager", (roles.villager ?? 0) + 1)}
              disabled={isFull}
            >
              +
            </button>
            <button
              aria-label="-"
              onClick={() => updateRole("villager", (roles.villager ?? 0) - 1)}
              disabled={(roles.villager ?? 0) === 0}
            >
              -
            </button>
          </li>
        </ul>
      )}

      <p>
        {total} / {target} rôles sélectionnés
      </p>

      <RoleRecap roles={roles} />

      {isHost && (
        <button onClick={() => startGame()} disabled={!valid}>
          Lancer la partie
        </button>
      )}
    </div>
  );
}

export default RoleSelect;
