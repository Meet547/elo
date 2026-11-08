import {NextRequest,NextResponse} from 'next/server';
import {db} from '../../../../lib/db';
import {sessionPlayer} from '../../../../lib/session';
import {rateLimit,tooMany} from '../../../../lib/rate-limit';
export async function GET(req:NextRequest){
 const id=await sessionPlayer(req);
 if(!id)return NextResponse.json({error:'Sign in first.'},{status:401,headers:{'cache-control':'no-store'}});
 const limit=await rateLimit(req,`account:export:${id}`,10,600_000);
 if(!limit.ok)return tooMany(limit.retryAfter);
 const [player,history,identities,participation]=await db.$transaction([
  db.player.findUniqueOrThrow({where:{id},select:{id:true,name:true,rating:true,rd:true,volatility:true,rated:true,rankedPlacements:true,peak:true,hands:true,cashes:true,netChips:true,biggestPot:true,streak:true,createdAt:true,lastSeen:true}}),
  db.session.findMany({where:{playerId:id},orderBy:[{createdAt:'asc'},{id:'asc'}]}),
  db.externalIdentity.findMany({where:{playerId:id},select:{provider:true,email:true,verifiedAt:true}}),
  db.matchParticipant.findMany({where:{playerId:id},select:{matchId:true,seat:true,ratingSnapshot:true}}),
 ]);
 return NextResponse.json({version:1,exportedAt:new Date().toISOString(),player,history,identities,participation},{headers:{'cache-control':'private, no-store','content-disposition':'attachment; filename="elo-account.json"'}});
}
