import 'server-only';
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
/** WS6 adds the explicit ready-check UI; current automatic startup is retained here. */
export async function createActiveRankedMatch(tx: Prisma.TransactionClient, players: Participant[], now: Date) {
  if (players.length !== 2 || players[0].id === players[1].id) throw new Error('A ranked match requires two distinct players.');
  const match = await tx.match.create({ data: { participants: { create: players.map((player, seat) => ({
    playerId: player.id, seat, ratingSnapshot: { rating: player.rating, rd: player.rd, volatility: player.volatility, rated: player.rated },
  })) } } });
  for (const [from, to] of [['QUEUED','PROPOSED'], ['PROPOSED','READY'], ['READY','ACTIVE']] as const) {
    if (!await transitionMatch(tx, match.id, from, to, to === 'ACTIVE' ? { handNumber: 1, startedAt: now } : {})) throw new Error('Match startup conflict.');
  }
  return match.id;
}
