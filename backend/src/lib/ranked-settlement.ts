import 'server-only';
import { Prisma, type LiveRoom, type Player } from '@prisma/client';
import { z } from 'zod';
import { applySession } from '@/lib/rating';
import { liveStandings, type LiveTable } from '@/lib/poker/live-table';
import { RANKED_HANDS } from '@/lib/poker/ranked-match';
import {inTransaction,ownsTransaction,ConcurrentGameWrite as RoomRevisionConflict,type DatabaseClient} from './unit-of-work';
import { transitionMatch } from './match-state';

const snapshotSchema = z.object({ rating: z.number().finite(), rd: z.number().finite(), volatility: z.number().finite(), rated: z.int().nonnegative() });
const ratingState = (p: Player) => ({ rating: p.rating, rd: p.rd, volatility: p.volatility, rated: p.rated,
  rankedPlacements: p.rankedPlacements, peak: p.peak, hands: p.hands, cashes: p.cashes, netChips: p.netChips, biggestPot: p.biggestPot, streak: p.streak });

/** Player updates, unique history and unique settlement are one database commit. */
async function writeResult(tx: Prisma.TransactionClient, matchId: string, table: LiveTable) {
  const standings = liveStandings(table);
  if (standings.length !== 2 || (table.ranked?.completedHands !== RANKED_HANDS && table.ranked?.outcome?.kind !== 'forfeit')) throw new Error('Incomplete ranked result.');
  const playedHands = table.ranked!.completedHands;
  const forfeit = table.ranked!.outcome?.kind === "forfeit";
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
      rating: rating.rating, rd: rating.rd, volatility: rating.volatility, rated: { increment: 1 }, rankedPlacements: { increment: 1 },
      peak: Math.max(me.peak, rating.rating), hands: { increment: playedHands },
      cashes: { increment: seat.place === 1 ? 1 : 0 }, netChips: { increment: seat.net },
      biggestPot: Math.max(me.biggestPot, seat.biggestPot),
      streak: seat.place === 0 ? 0 : seat.place === 1 ? Math.max(0, me.streak) + 1 : Math.min(0, me.streak) - 1,
      lastSeen: new Date(), ratedAt: new Date(),
    } });
    await tx.session.create({ data: {
      matchId, mode: 'RANKED', playerId: me.id, hands: playedHands, seats: 2,
      finalStack: seat.stack, net: seat.net, place: seat.place,
      ratingBefore: before.rating, ratingAfter: rating.rating, biggestPot: seat.biggestPot,
      potsWon: seat.potsWon, bestHand: seat.bestHand,
      bestSeenHand: seat.bestSeen?.name, bestSeenScore: seat.bestSeen?.score,
      bestWinningHand: seat.bestWinning?.name, bestWinningScore: seat.bestWinning?.score,
      exit: forfeit ? `Forfeit ${seat.place === 1 ? 'win' : 'loss'} · ${playedHands} hands` : seat.place === 0 ? 'Ranked draw · 10 hands' : `Ranked ${seat.place === 1 ? 'win' : 'loss'} · 10 hands · total chip profit`,
    } });
    changes.push({ playerId: me.id, place: seat.place, net: seat.net, before: ratingState(me), after: ratingState(after) });
  }
  await tx.matchSettlement.create({ data: {
    matchId, algorithmVersion: 'adapted-glicko2-v1',
    result: { mode: 'RANKED', hands: playedHands, outcome: table.ranked!.outcome ?? null, scores: table.ranked!.scores, players: changes },
  } });
  return ratings;
}

async function persistPresence(tx:Prisma.TransactionClient,matchId:string,table:LiveTable){
  for(const [seat,at] of (table.ranked?.lastSeen??[]).entries()){
    await tx.matchParticipant.updateMany({where:{matchId,seat,lastSeenAt:{lt:new Date(at)}},data:{lastSeenAt:new Date(at)}});
  }
}

async function commitVoid(client:DatabaseClient,row:LiveRoom,table:LiveTable){
  try{return await inTransaction(client,async tx=>{
    if(!await transitionMatch(tx,row.matchId!,'ACTIVE','VOID',{finishedAt:new Date()}))return false;
    const changed=await tx.liveRoom.updateMany({where:{code:row.code,revision:row.revision},data:{state:JSON.stringify(table),revision:{increment:1},nextDeadlineAt:null}});
    if(!changed.count)throw new RoomRevisionConflict();
    await tx.matchSettlement.create({data:{matchId:row.matchId!,algorithmVersion:'void-no-rating-v1',result:{outcome:table.ranked!.outcome!,ratingChanges:[]}}});
    await tx.rankedSeat.deleteMany({where:{roomCode:row.code}});return true;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}catch(error){
    if(!ownsTransaction(client))throw error;
    if(error instanceof RoomRevisionConflict||(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034'))return false;
    throw error;
  }
}

async function commitProposal(client: DatabaseClient, row: LiveRoom, table: LiveTable) {
  const matchId = row.matchId!;
  try {
    return await inTransaction(client,async tx => {
      await persistPresence(tx,matchId,table);
      if (table.status === 'playing' && table.game?.handNo === 1 && table.ranked?.proposal?.accepted.every(Boolean)) {
        if (!await transitionMatch(tx, matchId, 'PROPOSED', 'READY') ||
            !await transitionMatch(tx, matchId, 'READY', 'ACTIVE', {handNumber:1,startedAt:new Date()})) throw new RoomRevisionConflict();
        await tx.match.update({where:{id:matchId},data:{readyDeadlineAt:null}});
      } else if (table.status === 'closed') {
        if (!await transitionMatch(tx, matchId, 'PROPOSED', 'VOID', {finishedAt:new Date()})) throw new RoomRevisionConflict();
        const proposal = table.ranked!.proposal!;
        const keep = table.players.filter((_,idx)=>proposal.declinedBy !== undefined ? idx !== proposal.declinedBy : proposal.accepted[idx]);
        if (keep.length) await tx.rankedSeat.updateMany({where:{roomCode:row.code,playerId:{in:keep.map(player=>player.id)}},data:{roomCode:null,seenAt:new Date()}});
        await tx.rankedSeat.deleteMany({where:{roomCode:row.code}});
        await tx.matchSettlement.create({data:{matchId,algorithmVersion:'ready-void-v1',result:{reason:table.ranked!.cancelReason??'cancelled',ratingChanges:[]}}});
        await tx.match.update({where:{id:matchId},data:{readyDeadlineAt:null}});
      } else if (table.status === 'waiting' && table.game === null) {
        const claimed = await tx.match.updateMany({where:{id:matchId,state:'PROPOSED'},data:{version:{increment:1},readyDeadlineAt:table.nextAt===null?null:new Date(table.nextAt)}});
        if (!claimed.count) throw new RoomRevisionConflict();
      } else throw new Error('Invalid proposal state.');
      const updated = await tx.liveRoom.updateMany({where:{code:row.code,revision:row.revision},data:{state:JSON.stringify(table),revision:{increment:1},nextDeadlineAt:table.nextAt===null?null:new Date(table.nextAt)}});
      if (!updated.count) throw new RoomRevisionConflict();
      return true;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }catch(error){
    if(!ownsTransaction(client))throw error;
    if(error instanceof RoomRevisionConflict||(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034'))return false;
    throw error;
  }
}

export async function commitRankedRoom(client: DatabaseClient, row: LiveRoom, table: LiveTable) {
  const matchId = row.matchId;
  if (!matchId || table.ranked?.matchId !== matchId) throw new Error('Ranked room needs its migrated match identity.');
  const previous = JSON.parse(row.state) as LiveTable;
  if (!previous.game && previous.ranked?.proposal) return commitProposal(client, row, table);
  const previousHand = previous.game?.handNo;
  const hand = table.game?.handNo;
  if (!hand || !previousHand || hand < previousHand || hand > previousHand + 1 || hand > RANKED_HANDS) throw new Error('Invalid ranked hand progression.');
  if (table.ranked?.outcome?.kind === "void") return commitVoid(client,row,table);
  const finished = table.status === 'finished';
  try {
    return await inTransaction(client,async tx => {
      await persistPresence(tx,matchId,table);
      if (finished) {
        if (table.ranked?.ratings || !await transitionMatch(tx, matchId, 'ACTIVE', 'SETTLING')) return false;
      } else {
        const claimed = await tx.match.updateMany({ where: { id: matchId, state: 'ACTIVE', handNumber: previousHand },
          data: { handNumber: hand, version: { increment: 1 } } });
        if (!claimed.count) return false;
      }
      const updated = await tx.liveRoom.updateMany({ where: { code: row.code, revision: row.revision }, data: {
        nextDeadlineAt: table.nextAt === null ? null : new Date(table.nextAt), state: JSON.stringify(table), revision: { increment: 1 }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } });
      if (!updated.count) throw new RoomRevisionConflict();
      if (finished) {
        table.ranked!.ratings = await writeResult(tx, matchId, table);
        if (!await transitionMatch(tx, matchId, 'SETTLING', table.ranked!.outcome?.kind === 'forfeit' ? 'FORFEIT' : 'SETTLED', { finishedAt: new Date() })) throw new RoomRevisionConflict();
        await tx.liveRoom.update({ where: { code: row.code }, data: { state: JSON.stringify(table) } });
        await tx.rankedSeat.deleteMany({ where: { roomCode: row.code } });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    if(!ownsTransaction(client))throw error;
    if (error instanceof RoomRevisionConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) return false;
    throw error;
  }
}
