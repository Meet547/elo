import {NextRequest,NextResponse} from 'next/server';
import {db} from "../../../lib/db";
import {rateLimit,tooMany} from "../../../lib/rate-limit";
import {clearSessionCookie} from "../../../lib/session";
import {sessionPlayer} from '../../../lib/session';
import {accountIdentity} from '../../../lib/google-auth';
export async function GET(req:NextRequest){
 const playerId=await sessionPlayer(req);
 if(!playerId)return NextResponse.json({error:'Sign in first.'},{status:401,headers:{'cache-control':'no-store'}});
 return NextResponse.json({...await accountIdentity(playerId),googleAvailable:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.NEXT_PUBLIC_SITE_URL)},{headers:{'cache-control':'no-store'}});
}

/** Close credentials/profile; settlement history remains for integrity and audit. */
export async function DELETE(req:NextRequest){
 const id=await sessionPlayer(req);
 if(!id)return NextResponse.json({error:'Sign in first.'},{status:401,headers:{'cache-control':'no-store'}});
 const limit=await rateLimit(req,'account:close',5,600_000,id);
 if(!limit.ok)return tooMany(limit.retryAfter);
 if((await req.json().catch(()=>null))?.confirm!=='DELETE')return NextResponse.json({error:'Explicit confirmation is required.'},{status:400});
 const closed=await db.$transaction(async tx=>{
  const active=await tx.matchParticipant.count({where:{playerId:id,match:{state:{in:['QUEUED','PROPOSED','READY','ACTIVE','SETTLING']}}}});
  const rooms=await tx.liveRoom.findMany({where:{expiresAt:{gt:new Date()}},select:{state:true}});
  if(active||rooms.some(row=>{const table=JSON.parse(row.state);return table.status==='playing'&&table.players.some((player:{id:string})=>player.id===id);}))return false;
  await tx.rankedSeat.deleteMany({where:{playerId:id}});
  await tx.commandReceipt.deleteMany({where:{actorId:id}});
  await tx.authSession.deleteMany({where:{playerId:id}});
  await tx.oAuthAttempt.deleteMany({where:{playerId:id}});
  await tx.externalIdentity.deleteMany({where:{playerId:id}});
  await tx.player.update({where:{id},data:{name:'Deleted player',nameKey:null,deletedAt:new Date(),legacySessionsRevoked:true}});
  return true;
 },{isolationLevel:'Serializable'});
 if(!closed)return NextResponse.json({error:'Finish or leave your active game before closing your account.'},{status:409,headers:{'cache-control':'no-store'}});
 const response=NextResponse.json({closed:true,retained:'Match records are retained for game integrity.'},{headers:{'cache-control':'no-store'}});
 clearSessionCookie(response);return response;
}
