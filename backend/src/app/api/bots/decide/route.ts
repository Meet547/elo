import { NextRequest, NextResponse } from 'next/server';
import { sessionPlayer } from '@/lib/session';
import { rateLimit, tooMany } from '@/lib/rate-limit';
import { botViewSchema, cloudDecision } from '@/lib/ollama';
export async function POST(request: NextRequest) {
  const player=await sessionPlayer(request);
  if (!player) return NextResponse.json({error:'Claim a profile first.'},{status:401});
  const limit=await rateLimit(request,"bots",90,60000,player);
  if (!limit.ok) return tooMany(limit.retryAfter);
  if (Number(request.headers.get('content-length') || 0)>8192) return NextResponse.json({error:'Request too large.'},{status:413});
  const input=botViewSchema.safeParse(await request.json().catch(()=>null));
  if (!input.success) return NextResponse.json({error:'Invalid bot view.'},{status:400});
  return NextResponse.json(await cloudDecision(input.data),{headers:{'Cache-Control':'no-store'}});
}
