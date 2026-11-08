import {NextRequest,NextResponse} from 'next/server';
import {sessionPlayer} from '../../../lib/session';
import {accountIdentity} from '../../../lib/google-auth';
export async function GET(req:NextRequest){
 const playerId=await sessionPlayer(req);
 if(!playerId)return NextResponse.json({error:'Sign in first.'},{status:401,headers:{'cache-control':'no-store'}});
 return NextResponse.json({...await accountIdentity(playerId),googleAvailable:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.NEXT_PUBLIC_SITE_URL)},{headers:{'cache-control':'no-store'}});
}
