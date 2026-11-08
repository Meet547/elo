import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { createLiveRoom } from "@/lib/live-rooms";
import { rateLimit } from "@/lib/rate-limit";
import {runGameCommand,commandHttp,commandLimited} from "../../../lib/command-receipts";
import { sessionPlayer } from "@/lib/session";

export async function POST(req: NextRequest) {
  const player = await sessionPlayer(req);
  if (!player) return NextResponse.json({ error: "Claim an Elo profile first." }, { status: 401 });
  if (!dbEnabled) return NextResponse.json({ error: "Live rooms need a database connection." }, { status: 503 });
  try{return commandHttp(await runGameCommand(player,"live:create",req.headers.get('idempotency-key'),{},async tx=>{
    const limit=await rateLimit(req,"live:create",8,60_000,player,tx);
    if(!limit.ok)return commandLimited(limit.retryAfter);
    const room=await createLiveRoom(player,tx);
    return room?{status:201,body:{room}}:{status:401,body:{error:"Claim an Elo profile first."}};
  }));}catch{return NextResponse.json({error:'Could not create the room. Please retry.'},{status:503,headers:{'cache-control':'no-store'}});}
}
