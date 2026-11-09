import 'server-only';
import {db} from './db';
import {processRoomDeadline} from './live-rooms';
import {transitionMatch} from './match-state';
import {allowsMatchTransition,type MatchPhase} from '@/lib/poker/match-state';
import {RANKED_PRESENCE_MS} from '@/lib/poker/ranked-match';
import {refreshFairEvidence,type LiveTable} from '@/lib/poker/live-table';

/** One bounded cycle; no client-provided clock, action, player or game state. */
export async function processDeadlineBatch(now=Date.now()){
 const date=new Date(now);
 const due=await db.liveRoom.findMany({where:{nextDeadlineAt:{lte:date},expiresAt:{gt:date}},orderBy:{nextDeadlineAt:'asc'},take:50,select:{code:true}});
 let processed=0;
 for(const row of due)if(await processRoomDeadline(row.code))processed++;
 const expired=await db.liveRoom.findMany({where:{expiresAt:{lte:date},nextDeadlineAt:{not:null}},take:50});
 for(const row of expired)await db.$transaction(async tx=>{
  if(row.matchId){
   const match=await tx.match.findUnique({where:{id:row.matchId}});
   if(match&&allowsMatchTransition(match.state as MatchPhase,'VOID')){
    if(!await transitionMatch(tx,match.id,match.state as MatchPhase,'VOID',{finishedAt:date}))return;
    await tx.matchSettlement.create({data:{matchId:match.id,algorithmVersion:'expired-void-v1',result:{reason:'expired-room',ratingChanges:[]}}});
   }else if(match&&!['SETTLED','VOID','FORFEIT'].includes(match.state))return;
  }
  const table=JSON.parse(row.state) as LiveTable;table.status='closed';table.nextAt=null;
  if(table.ranked)table.ranked.outcome={kind:'void',reason:'expired-room'};
  refreshFairEvidence(table);
  const changed=await tx.liveRoom.updateMany({where:{code:row.code,revision:row.revision},data:{state:JSON.stringify(table),nextDeadlineAt:null,revision:{increment:1}}});
  if(!changed.count)throw new Error("Expired room revision changed; retry next cycle.");
  await tx.rankedSeat.deleteMany({where:{roomCode:row.code}});
 },{isolationLevel:'Serializable'});
 const [queue,limits,sessions,oauth,receipts,events]=await db.$transaction([
  db.rankedSeat.deleteMany({where:{roomCode:null,seenAt:{lt:new Date(now-RANKED_PRESENCE_MS)}}}),
  db.rateWindow.deleteMany({where:{resetAt:{lte:date}}}),
  db.authSession.deleteMany({where:{expiresAt:{lte:date}}}),
  db.oAuthAttempt.deleteMany({where:{expiresAt:{lte:date}}}),
  db.commandReceipt.deleteMany({where:{expiresAt:{lte:date}}}),
  db.roomEvent.deleteMany({where:{createdAt:{lt:new Date(now-86400_000)}}}),
 ]);
 return {processed,expired:expired.length,queueReleased:queue.count,limitsRemoved:limits.count,sessionsRemoved:sessions.count,oauthRemoved:oauth.count,receiptsRemoved:receipts.count,eventsRemoved:events.count,batchLimited:due.length===50};
}
