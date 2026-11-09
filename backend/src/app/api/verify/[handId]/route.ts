import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {rateLimit,tooMany} from '@/lib/rate-limit';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{handId:string}>}){
 const handId=(await params).handId;
 if(!/^[a-f0-9]{64}$/.test(handId))return NextResponse.json({error:'Hand record not found.'},{status:404});
 const limit=await rateLimit(req,'fair:verify',120,60_000);if(!limit.ok)return tooMany(limit.retryAfter);
 const record=await db.fairHand.findUnique({where:{handId},select:{publicData:true}});
 return record?NextResponse.json({hand:record.publicData},{headers:{'cache-control':'private, no-store'}}):NextResponse.json({error:'Hand record not found.'},{status:404});
}
