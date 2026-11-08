import {NextRequest} from 'next/server';
import {POST} from '../../backend/src/app/api/live/route';
import {signSession,SESSION_COOKIE} from '../../backend/src/lib/session';
import {db} from '../../backend/src/lib/db';
const [actor,key]=process.argv.slice(2);
try{await POST(new NextRequest('https://fixture.example/api/live',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=${signSession(actor)}`,'idempotency-key':key,'x-elo-client-ip':'command-crash'}}));}finally{await db.$disconnect();}
