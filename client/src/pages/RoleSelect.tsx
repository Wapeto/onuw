import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { GameMode, RoleId } from "@onuw/shared";
import { ROLE_IDS, totalRoleCount, MIN_DAY_DURATION_MS, MAX_DAY_DURATION_MS } from "@onuw/shared";
import { useRoomSocket } from "../hooks/useRoomSocket";
import RoleRecap from "../components/RoleRecap";
import OnboardingNotice from "../components/OnboardingNotice";
import Screen from "../components/ui/Screen";
import Waiting from "../components/ui/Waiting";
import { isOnboardingDismissed, dismissOnboarding } from "../onboardingStorage";
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
  const { playerId, players, roleSelection, myRole, currentTick, setRoleMode, setCustomRoles, startGame, dayDurationMs, setDayDuration } = useRoomSocket();

  // Shown immediately on arrival, not gated on currentTick/night starting:
  // gating on currentTick meant the notice raced tick 0's already-running
  // clock (TICK_START is broadcast the instant the server arms tick 0's
  // timer), risking a new group missing their own first tick while reading
  // it. Showing it as soon as the player lands here — well before the host
  // can even start the game — avoids that race entirely.
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => !routeRoomCode || isOnboardingDismissed(routeRoomCode),
  );

  // The deal now lands on the briefing screen rather than on tick 0. The
  // currentTick branch is the safety net for a client that missed YOUR_ROLE
  // (a socket blip across the deal): it must still follow the room into the
  // night instead of sitting here on a dead form.
  useEffect(() => {
    if (!routeRoomCode || !onboardingDismissed) return;
    if (currentTick) {
      navigate(`/room/${routeRoomCode}/night`);
    } else if (myRole) {
      navigate(`/room/${routeRoomCode}/role`);
    }
  }, [currentTick, myRole, routeRoomCode, navigate, onboardingDismissed]);

  const me = players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;

  if (!onboardingDismissed && routeRoomCode) {
    return (
      <OnboardingNotice
        onContinue={(dontShowAgain) => {
          if (dontShowAgain) dismissOnboarding(routeRoomCode);
          setOnboardingDismissed(true);
        }}
      />
    );
  }

  if (!roleSelection) {
    return <Waiting phase="lobby">Chargement de la configuration…</Waiting>;
  }

  const { mode, roles, valid } = roleSelection;
  const playerCount = players.length;
  const total = totalRoleCount(roles);
  const target = playerCount + 3;
  const isFull = total >= target;

  function updateRole(roleId: RoleId, nextCount: number) {
    setCustomRoles({ ...roles, [roleId]: Math.max(0, nextCount) });
  }

  // Non-hosts can't change anything here, so they get a read-only summary
  // instead of a wall of disabled controls.
  const remaining = target - total;

  return (
    <Screen phase="lobby">
      <header className="screen__head">
        <p className="eyebrow">Room {routeRoomCode}</p>
        <h1 className="display screen__title">Configuration des rôles</h1>
        <p className="screen__lede">
          {playerCount} joueurs · {target} cartes ({playerCount} distribuées, 3 au centre)
        </p>
      </header>

      <div className="screen__body stagger">
        {isHost && (
          <div className="segmented" role="group" aria-label="Mode de jeu">
            {MODES.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="btn"
                onClick={() => setRoleMode(candidate.id)}
                aria-pressed={mode === candidate.id}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        )}

        {mode === "custom" && isHost && (
          <div className="panel">
            <p className="panel__title">Rôles en jeu</p>
            <ul className="rolerows">
              {EDITABLE_ROLE_IDS.map((id) => {
                const count = roles[id] ?? 0;
                const isMason = id === "mason";
                const isWerewolf = id === "werewolf";
                const cap = isWerewolf || isMason ? 2 : 1;
                const atCap = count >= cap;
                const insomniacBlocked =
                  id === "insomniac" && count === 0 && (roles.robber ?? 0) === 0 && (roles.troublemaker ?? 0) === 0;

                return (
                  <li key={id} className="rolerow">
                    <span className="rolerow__name">{roleLabel(id)}</span>
                    <span className="rolerow__count" data-zero={count === 0}>
                      {count}
                    </span>
                    <span className="stepper">
                      <button
                        type="button"
                        className="btn"
                        aria-label="-"
                        onClick={() => updateRole(id, isMason ? 0 : count - 1)}
                        disabled={count === 0}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="btn"
                        aria-label="+"
                        onClick={() => updateRole(id, isMason ? 2 : count + 1)}
                        disabled={atCap || isFull || insomniacBlocked}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
              <li className="rolerow">
                <span className="rolerow__name">{roleLabel("villager")}</span>
                <span className="rolerow__count" data-zero={(roles.villager ?? 0) === 0}>
                  {roles.villager ?? 0}
                </span>
                <span className="stepper">
                  <button
                    type="button"
                    className="btn"
                    aria-label="-"
                    onClick={() => updateRole("villager", (roles.villager ?? 0) - 1)}
                    disabled={(roles.villager ?? 0) === 0}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label="+"
                    onClick={() => updateRole("villager", (roles.villager ?? 0) + 1)}
                    disabled={isFull}
                  >
                    +
                  </button>
                </span>
              </li>
            </ul>
          </div>
        )}

        <div className="panel">
          <div className="tally">
            <span className="panel__title" style={{ marginBottom: 0 }}>
              Sélection
            </span>
            <span className="tally__value" data-complete={total === target}>
              {total} / {target}
            </span>
          </div>
          <div className="meter">
            <div
              className="meter__fill"
              style={{ width: `${Math.min((total / target) * 100, 100)}%` }}
            />
          </div>
          <div style={{ marginTop: "var(--space-4)" }}>
            <RoleRecap roles={roles} />
          </div>
        </div>

        <div className="panel">
          <p className="panel__title">Durée de la discussion</p>
          {isHost ? (
            <div className="row">
              <input
                id="day-duration"
                className="input input--number"
                type="number"
                inputMode="numeric"
                aria-label="Durée de la discussion en minutes"
                min={MIN_DAY_DURATION_MS / 60_000}
                max={MAX_DAY_DURATION_MS / 60_000}
                value={dayDurationMs / 60_000}
                onChange={(e) => setDayDuration(Number(e.target.value) * 60_000)}
              />
              <label htmlFor="day-duration" className="muted">
                minutes
              </label>
            </div>
          ) : (
            <p>{dayDurationMs / 60_000} min</p>
          )}
        </div>
      </div>

      <div className="screen__spacer" />

      <footer className="screen__foot">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => startGame()}
              disabled={!valid}
            >
              Lancer la partie
            </button>
            <p className="hint">
              {valid
                ? "Chacun découvre sa carte, puis la nuit commence"
                : remaining > 0
                  ? `Ajoute encore ${remaining} carte${remaining > 1 ? "s" : ""}`
                  : "Cette combinaison de rôles n'est pas jouable"}
            </p>
          </>
        ) : (
          <p className="hint">En attente de l'hôte…</p>
        )}
      </footer>
    </Screen>
  );
}

export default RoleSelect;
