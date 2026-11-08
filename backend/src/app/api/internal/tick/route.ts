import {NextRequest,NextResponse} from 'next/server';
import {verifyWorkerSecret} from '@/lib/server/worker-auth.mjs';
import {processDeadlineBatch} from '../../../../lib/deadline-worker';
export async function POST(req:NextRequest){
 if(!verifyWorkerSecret(req.headers.get('x-elo-worker-secret'),process.env.SESSION_SECRET))return NextResponse.json({error:'Forbidden.'},{status:403});
 try{return NextResponse.json(await processDeadlineBatch(),{headers:{'cache-control':'no-store'}});}
 catch{console.error(JSON.stringify({event:'deadline_worker_failure'}));return NextResponse.json({error:'Deadline processing failed.'},{status:503,headers:{'cache-control':'no-store'}});}
}
