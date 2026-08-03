import type { Player, RevealState, RoleId, WinningTeam } from "@onuw/shared";
import { requireCurrentRole } from "../roles/helpers.js";

export function roleTeam(roleId: RoleId): WinningTeam {
  if (roleId === "werewolf" || roleId === "minion") return "werewolf";
  if (roleId === "tanner") return "tanner";
  return "village";
}

function chainHunterKills(
  roleOf: Map<string, RoleId>,
  votes: Record<string, string>,
  eliminated: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...eliminated]) {
      if (roleOf.get(id) !== "hunter") continue;
      const target = votes[id];
      if (target && !eliminated.has(target)) {
        eliminated.add(target);
        changed = true;
      }
    }
  }
}

export function computeWinConditions(
  players: Player[],
  votes: Record<string, string>,
  votedEliminated: string[],
): Omit<RevealState, "tally"> {
  const roleOf = new Map(players.map((p) => [p.id, requireCurrentRole(p)]));
  const eliminated = new Set(votedEliminated);
  chainHunterKills(roleOf, votes, eliminated);

  const finalEliminated = [...eliminated];
  const eliminatedRoles = finalEliminated.map((id) => roleOf.get(id));
  const tannerDied = eliminatedRoles.includes("tanner");
  const werewolfDied = eliminatedRoles.includes("werewolf");

  const winningTeam: WinningTeam = tannerDied ? "tanner" : werewolfDied ? "village" : "werewolf";

  const winners = players
    .filter((p) => {
      const role = requireCurrentRole(p);
      if (winningTeam === "tanner") return role === "tanner" && eliminated.has(p.id);
      return roleTeam(role) === winningTeam;
    })
    .map((p) => p.id);

  return { eliminated: finalEliminated, winningTeam, winners };
}
