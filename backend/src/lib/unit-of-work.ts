import {Prisma,type PrismaClient} from '@prisma/client';
export type DatabaseClient=PrismaClient|Prisma.TransactionClient;
export const ownsTransaction=(client:DatabaseClient):client is PrismaClient=>'$transaction' in client;
export function serializationConflict(error:unknown){
 return error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2034'||(error.code==='P2010'&&['40001','40P01'].includes(String(error.meta?.code))));
}
export async function inTransaction<T>(client:DatabaseClient,work:(tx:Prisma.TransactionClient)=>Promise<T>,options:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number}={}):Promise<T>{
 if(!ownsTransaction(client))return work(client);
 for(let attempt=0;;attempt++){
  try{return await client.$transaction(work,{isolationLevel:'Serializable',...options});}
  catch(error){
   if(attempt>=7||!serializationConflict(error))throw error;
   // Retry the complete owning unit, never a statement inside an aborted transaction.
   await new Promise(resolve=>setTimeout(resolve,Math.min(100,5*2**attempt)+Math.random()*20));
  }
 }
}
export class ConcurrentGameWrite extends Error {}
