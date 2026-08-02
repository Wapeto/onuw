export interface VoteResult {
  tally: Record<string, number>;
  eliminated: string[];
}

export function resolveVotes(votes: Record<string, string>, playerIds: string[]): VoteResult {
  const tally: Record<string, number> = {};
  for (const id of playerIds) tally[id] = 0;
  for (const targetId of Object.values(votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  const counts = Object.values(tally);
  const maxVotes = counts.length > 0 ? Math.max(...counts) : 0;
  const eliminated = maxVotes > 0 ? playerIds.filter((id) => tally[id] === maxVotes) : [];

  return { tally, eliminated };
}
