import 'server-only';
import { Prisma, type LiveRoom, type Player, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { applySession } from '@/lib/rating';
import { liveStandings, type LiveTable } from '@/lib/poker/live-table';
import { RANKED_HANDS } from '@/lib/poker/ranked-match';
import { transitionMatch } from './match-state';

class RoomRevisionConflict extends Error {}
const snapshotSchema = z.object({ rating: z.number().finite(), rd: z.number().finite(), volatility: z.number().finite(), rated: z.int().nonnegative() });
const ratingState = (p: Player) => ({ rating: p.rating, rd: p.rd, volatility: p.volatility, rated: p.rated,
  peak: p.peak, hands: p.hands, cashes: p.cashes, netChips: p.netChips, biggestPot: p.biggestPot, streak: p.streak });

/** Player updates, unique history and unique settlement are one database commit. */
async function writeResult(tx: Prisma.TransactionClient, matchId: string, table: LiveTable) {
  const standings = liveStandings(table);
  if (standings.length !== 2 || table.ranked?.completedHands !== RANKED_HANDS) throw new Error('Incomplete ranked result.');
  const participants = await tx.matchParticipant.findMany({ where: { matchId } });
  if (participants.length !== 2 || standings.some(seat => !participants.some(p => p.playerId === seat.id && p.seat === seat.idx))) throw new Error('Ranked participant mismatch.');
  const ids = standings.map(seat => seat.id).sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Player" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  const players = await tx.player.findMany({ where: { id: { in: ids } } });
  if (players.length !== 2) throw new Error('Missing ranked player.');
  const snapshots = new Map(participants.map(p => [p.playerId, snapshotSchema.parse(p.ratingSnapshot)]));
  const byId = new Map(players.map(p => [p.id, p]));
  const ratings: { before: number; after: number }[] = [];
  const changes = [];
  for (const seat of standings) {
    const me = byId.get(seat.id)!;
    const before = snapshots.get(me.id)!;
    const field = standings.filter(other => other.id !== me.id).map(other => ({ ...snapshots.get(other.id)!, place: other.place }));
    const rating = applySession(before, field, seat.place);
    ratings[seat.idx] = { before: before.rating, after: rating.rating };
    const after = await tx.player.update({ where: { id: me.id }, data: {
      rating: rating.rating, rd: rating.rd, volatility: rating.volatility, rated: { increment: 1 },
      peak: Math.max(me.peak, rating.rating), hands: { increment: RANKED_HANDS },
      cashes: { increment: seat.place === 1 ? 1 : 0 }, netChips: { increment: seat.net },
      biggestPot: Math.max(me.biggestPot, seat.biggestPot),
      streak: seat.place === 0 ? 0 : seat.place === 1 ? Math.max(0, me.streak) + 1 : Math.min(0, me.streak) - 1,
      lastSeen: new Date(),
    } });
    await tx.session.create({ data: {
      matchId, mode: 'RANKED', playerId: me.id, hands: RANKED_HANDS, seats: 2,
      finalStack: seat.stack, net: seat.net, place: seat.place,
      ratingBefore: before.rating, ratingAfter: rating.rating, biggestPot: seat.biggestPot,
      potsWon: seat.potsWon, bestHand: seat.bestHand,
      exit: seat.place === 0 ? 'Ranked draw · 10 hands' : `Ranked ${seat.place === 1 ? 'win' : 'loss'} · 10 hands · total chip profit`,
    } });
    changes.push({ playerId: me.id, place: seat.place, net: seat.net, before: ratingState(me), after: ratingState(after) });
  }
  await tx.matchSettlement.create({ data: {
    matchId, algorithmVersion: 'adapted-glicko2-v1',
    result: { mode: 'RANKED', hands: RANKED_HANDS, scores: table.ranked!.scores, players: changes },
  } });
  return ratings;
}

export async function commitRankedRoom(client: PrismaClient, row: LiveRoom, table: LiveTable) {
  const matchId = row.matchId;
  if (!matchId || table.ranked?.matchId !== matchId) throw new Error('Ranked room needs its migrated match identity.');
  const previous = JSON.parse(row.state) as LiveTable;
  const previousHand = previous.game?.handNo;
  const hand = table.game?.handNo;
  if (!hand || !previousHand || hand < previousHand || hand > previousHand + 1 || hand > RANKED_HANDS) throw new Error('Invalid ranked hand progression.');
  const finished = table.status === 'finished';
  try {
    return await client.$transaction(async tx => {
      if (finished) {
        if (table.ranked?.ratings || !await transitionMatch(tx, matchId, 'ACTIVE', 'SETTLING')) return false;
      } else {
        const claimed = await tx.match.updateMany({ where: { id: matchId, state: 'ACTIVE', handNumber: previousHand },
          data: { handNumber: hand, version: { increment: 1 } } });
        if (!claimed.count) return false;
      }
      const updated = await tx.liveRoom.updateMany({ where: { code: row.code, revision: row.revision }, data: {
        state: JSON.stringify(table), revision: { increment: 1 }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } });
      if (!updated.count) throw new RoomRevisionConflict();
      if (finished) {
        table.ranked!.ratings = await writeResult(tx, matchId, table);
        if (!await transitionMatch(tx, matchId, 'SETTLING', 'SETTLED', { finishedAt: new Date() })) throw new RoomRevisionConflict();
        await tx.liveRoom.update({ where: { code: row.code }, data: { state: JSON.stringify(table) } });
        await tx.rankedSeat.deleteMany({ where: { roomCode: row.code } });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    if (error instanceof RoomRevisionConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) return false;
    throw error;
  }
}
