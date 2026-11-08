import 'server-only';
import { RANKED_READY_MS } from '@/lib/poker/ranked-match';
import type { Prisma } from '@prisma/client';
import { allowsMatchTransition, type MatchPhase } from '@/lib/poker/match-state';

export async function transitionMatch(tx: Prisma.TransactionClient, id: string, from: MatchPhase, to: MatchPhase,
  data: { handNumber?: number; startedAt?: Date; finishedAt?: Date } = {}) {
  if (!allowsMatchTransition(from, to)) throw new Error(`Invalid match transition ${from} -> ${to}`);
  const claimed = await tx.match.updateMany({ where: { id, state: from }, data: { ...data, state: to, version: { increment: 1 } } });
  if (!claimed.count) return false;
  await tx.matchTransition.create({ data: { matchId: id, from, to } });
  return true;
}

type Participant = { id: string; rating: number; rd: number; volatility: number; rated: number };
export async function createProposedRankedMatch(tx: Prisma.TransactionClient, players: Participant[], now: Date) {
  if (players.length !== 2 || players[0].id === players[1].id) throw new Error('A ranked match requires two distinct players.');
  const match = await tx.match.create({ data: { readyDeadlineAt: new Date(now.getTime() + RANKED_READY_MS), participants: { create: players.map((player, seat) => ({
    playerId: player.id, seat, ratingSnapshot: { rating: player.rating, rd: player.rd, volatility: player.volatility, rated: player.rated },
  })) } } });
  if (!await transitionMatch(tx, match.id, 'QUEUED', 'PROPOSED')) throw new Error('Proposal conflict.');
  return match.id;
}
