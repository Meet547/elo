import {NextRequest,NextResponse} from 'next/server';
import {clearSessionCookie,revokePlayerSessions,revokeRequestSession,sessionPlayer} from '../../../../lib/session';
export async function POST(req:NextRequest){
  const playerId=await sessionPlayer(req);
  const all=(await req.json().catch(()=>null))?.all===true;
  if(playerId&&all)await revokePlayerSessions(playerId);
  else await revokeRequestSession(req);
  const response=NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});
  clearSessionCookie(response);return response;
}
