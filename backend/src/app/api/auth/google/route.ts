import {NextRequest,NextResponse} from 'next/server';
import {beginGoogle,oauthCookie} from '../../../../lib/google-auth';
import {rateLimit,tooMany} from '../../../../lib/rate-limit';
import {sessionPlayer} from '../../../../lib/session';
export async function GET(req:NextRequest){
  const limit=await rateLimit(req,"auth:google",10,600_000);
  if(!limit.ok)return tooMany(limit.retryAfter);
  try{
    const {url,browser}=await beginGoogle(await sessionPlayer(req));
    const response=NextResponse.redirect(url,303);
    response.cookies.set({name:oauthCookie,value:browser,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/api/auth/google',maxAge:600});
    response.headers.set('cache-control','no-store');return response;
  }catch{return NextResponse.json({error:'Google sign-in is not available yet.'},{status:503,headers:{'cache-control':'no-store'}});}
}
