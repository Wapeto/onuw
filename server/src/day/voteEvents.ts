import { z } from "zod";
import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@onuw/shared";
import { withRoom } from "../rooms/roomStore.js";
import { transition } from "../state/phases.js";
import { resolveVotes, type VoteResult } from "../state/voteResolver.js";
import type { Membership } from "../rooms/roleSelectEvents.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const submitVoteSchema = z.object({ targetPlayerId: z.string().min(1) });

class NotInVoteError extends Error {}
class InvalidTargetError extends Error {}

function errorMessageFor(err: unknown): string {
  if (err instanceof NotInVoteError) return "aucun vote en cours";
  if (err instanceof InvalidTargetError) return "cible de vote invalide";
  return "vote invalide";
}

export function registerVoteEvents(
  io: AppServer,
  socket: AppSocket,
  getMembership: () => Membership | null,
): void {
  socket.on("SUBMIT_VOTE", async (payload) => {
    const membership = getMembership();
    if (!membership) return;
    const parsed = submitVoteSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit("ROOM_ERROR", { message: "vote invalide" });
      return;
    }
    let result: VoteResult | null = null;
    try {
      const state = await withRoom(membership.roomCode, (room) => {
        if (room.phase !== "VOTE" || !room.vote) throw new NotInVoteError();
        const voterExists = room.players.some((p) => p.id === membership.playerId);
        const targetExists = room.players.some((p) => p.id === parsed.data.targetPlayerId);
        if (!voterExists || !targetExists) throw new InvalidTargetError();

        const votes = { ...room.vote.votes, [membership.playerId]: parsed.data.targetPlayerId };
        if (Object.keys(votes).length < room.players.length) {
          return { ...room, vote: { votes }, updatedAt: Date.now() };
        }
        result = resolveVotes(
          votes,
          room.players.map((p) => p.id),
        );
        return { ...transition(room, "REVEAL"), vote: null, updatedAt: Date.now() };
      });
      if (result) {
        io.to(state.roomCode).emit("VOTE_RESULT", result);
      }
    } catch (err) {
      socket.emit("ROOM_ERROR", { message: errorMessageFor(err) });
    }
  });
}
