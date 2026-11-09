import {NextRequest,NextResponse} from 'next/server';
import {consumeGoogleAttempt,googleConfig,googleIdentity,linkGoogleIdentity,oauthCookie} from '../../../../../lib/google-auth';
import {sessionPlayer,setSessionCookie} from '../../../../../lib/session';
export async function GET(req:NextRequest){
  try{
    const state=req.nextUrl.searchParams.get('state')??'',code=req.nextUrl.searchParams.get('code');
    if(!code||code.length>4096)throw new Error('Invalid sign-in response.');
    const attempt=await consumeGoogleAttempt(state,req.cookies.get(oauthCookie)?.value??'');
    const guest=await sessionPlayer(req);
    if(guest!==attempt.playerId)throw new Error('Browser identity changed during sign-in.');
    const identity=await googleIdentity(code,attempt.verifier,attempt.nonce);
    const playerId=await linkGoogleIdentity(identity,guest);
    const response=NextResponse.redirect(`${googleConfig().origin}/`,303);
    await setSessionCookie(response,playerId);
    response.cookies.set({name:oauthCookie,value:'',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/api/auth/google',maxAge:0});
    response.headers.set('cache-control','no-store');return response;
  }catch{return NextResponse.json({error:'Sign-in could not be completed. Return to Elo and try again.'},{status:400,headers:{'cache-control':'no-store'}});}
}
