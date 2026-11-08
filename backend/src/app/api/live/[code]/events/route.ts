import {createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import type {LiveRoom} from '@prisma/client';
import {roomCode} from '@/lib/live-rooms';
import {rateLimit,tooMany} from '@/lib/rate-limit';
import {sessionPlayer,SESSION_COOKIE} from '@/lib/session';
import {realtime,type StreamIdentity} from '../../../../../lib/realtime';
export const dynamic='force-dynamic';
export const maxDuration=30;
const json=(error:string,status:number)=>NextResponse.json({error},{status,headers:{'cache-control':'no-store'}});
export async function GET(req:NextRequest,{params}:{params:Promise<{code:string}>}){
 const actorId=await sessionPlayer(req);
 if(!actorId)return json('Sign in first.',401);
 const code=roomCode((await params).code);
 if(!code)return json('Room not found.',404);
 const limit=await rateLimit(req,`live:events:${actorId}`,24,60_000);
 if(!limit.ok)return tooMany(limit.retryAfter);
 const cursor=req.headers.get('last-event-id')??req.nextUrl.searchParams.get('after');
 if(cursor!==null&&(!/^\d+$/.test(cursor)||Number(cursor)>2147483647))return json('Invalid event cursor.',400);
 try{
  const hub=await realtime.get(code);
  if(!hub?.row||!hub.table)return json('Room not found.',404);
  if(hub.table.ranked&&!hub.table.players.some(player=>player.id===actorId)){hub.idle();return json('Room not found.',404);}
  await hub.prepare(actorId);
  if(!hub.row||!hub.table)return json('Room not found.',404);
  if(await sessionPlayer(req)!==actorId){hub.idle();return json('Session ended.',401);}
  const raw=req.cookies.get(SESSION_COOKIE)?.value??'';
  const identity:StreamIdentity={actorId,tag:createHash('sha256').update(raw).digest('hex'),legacy:!raw.startsWith('v1.')};
  if(realtime.revoked(identity)){hub.idle();return json('Session ended.',401);}
  const encoder=new TextEncoder();
  let stop=()=>{},pull=()=>{};
  const stream=new ReadableStream<Uint8Array>({
   start(controller){
    let closed=false,initializing=true,last=-1,pending:LiveRoom|null=null;
    let capacity:(()=>void)|undefined;
    let unsubscribe=()=>{};
    let expires:ReturnType<typeof setTimeout>|undefined,heartbeat:ReturnType<typeof setInterval>|undefined;
    const close=()=>{
     if(closed)return;closed=true;clearTimeout(expires);clearInterval(heartbeat);
     req.signal.removeEventListener('abort',close);unsubscribe();capacity?.();capacity=undefined;
     try{controller.close();}catch{}
    };
    stop=close;
    const emit=(row:LiveRoom)=>{
     if(closed||row.revision<=last)return;
     controller.enqueue(encoder.encode((last<0?'retry: 750\n':'')+hub.frame(row,actorId)));last=row.revision;
     const state=JSON.parse(row.state);
     if(state.status==='finished'||state.status==='closed')close();
    };
    const live=(row:LiveRoom)=>{
     if(closed||row.revision<=last)return;
     if(initializing||(controller.desiredSize??0)<=0){if(!pending||row.revision>pending.revision)pending=row;return;}
     emit(row);
    };
    const drain=()=>{capacity?.();capacity=undefined;if(!initializing&&pending&&(controller.desiredSize??0)>0){const row=pending;pending=null;emit(row);}};
    pull=drain;
    unsubscribe=hub.observe({identity,update:live,close});
    if(req.signal.aborted)return close();
    req.signal.addEventListener('abort',close,{once:true});
    expires=setTimeout(close,23_000);
    heartbeat=setInterval(()=>{if(!closed&&(controller.desiredSize??0)>0)controller.enqueue(encoder.encode(': heartbeat\n\n'));},10_000);
    void(async()=>{
     const first=hub.row!;
     const after=cursor===null?null:Number(cursor);
     if(after!==null&&after<first.revision){
      const events=await hub.replay(after,first.revision);
      const complete=events.length<=128&&events.length===first.revision-after&&events.every((event,index)=>event.revision===after+index+1);
      if(complete){
       for(const event of events){
        while(!closed&&(controller.desiredSize??0)<=0)await new Promise<void>(resolve=>{capacity=resolve;});
        if(closed)return;
        emit({...first,revision:event.revision,state:JSON.stringify(event.state)});
       }
      }else emit(first);
     }else emit(first);
     initializing=false;drain();
    })().catch(close);
   },
   pull(){pull();},
   cancel(){stop();},
  },{highWaterMark:64*1024,size:chunk=>chunk.byteLength});
  return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'private, no-store, no-transform','x-accel-buffering':'no'}});
 }catch{return json('Realtime connection is temporarily unavailable.',503);}
}
