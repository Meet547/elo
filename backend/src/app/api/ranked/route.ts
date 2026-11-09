import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { updateRankedQueue, RankedEligibilityError, rankedNetworkTag } from "@/lib/ranked-queue";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import {runGameCommand,commandHttp,commandLimited} from "../../../lib/command-receipts";
import { sessionPlayer } from "@/lib/session";

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const player = await sessionPlayer(req);
  if (!player) return json({ error: "Claim an Elo profile first." }, 401);
  if (!dbEnabled) return json({ error: "Ranked play needs a database connection." }, 503);
  const command=(await req.json().catch(()=>null))?.command;
  if(command!=='join'&&command!=='poll'&&command!=='cancel')return json({error:'Invalid queue command.'},400);
  try{return commandHttp(await runGameCommand(player,'queue',req.headers.get('idempotency-key'),{command},async tx=>{
    const limit=await rateLimit(req,'ranked',60,60_000,player,tx);
    if(!limit.ok)return commandLimited(limit.retryAfter);
    try{
      const result=await updateRankedQueue(player,command,tx,command==='join'?rankedNetworkTag(clientKey(req)):undefined);
      return result?{status:200,body:result}:{status:401,body:{error:'Claim an Elo profile first.'}};
    }catch(error){if(error instanceof RankedEligibilityError)return {status:403,body:{error:error.message}};throw error;}
  },command==='poll'?60_000:7*86400_000));}
  catch{return json({error:'Could not reach the ranked queue. Retry with the same command key.'},503);}
}
