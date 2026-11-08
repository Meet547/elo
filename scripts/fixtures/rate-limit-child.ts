import {NextRequest} from 'next/server';
import {db} from '../../backend/src/lib/db';
import {rateLimit} from '../../backend/src/lib/rate-limit';
const req=new NextRequest('https://fixture.example/api/account',{method:'POST',headers:{'x-elo-client-ip':process.argv[2]}});
try{
 const result=await rateLimit(req,process.argv[3],1,60000,process.argv[4]);
 console.log(JSON.stringify(result));
}finally{await db.$disconnect();}
