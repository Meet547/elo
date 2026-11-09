import 'server-only';
import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {serializationConflict,ConcurrentGameWrite} from './unit-of-work';
export type CommandResponse={status:number;body:unknown;headers?:Record<string,string>};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
/** The result and all game writes commit together, including on process failure. */
export async function runGameCommand(actorId:string,scope:string,key:string|null,payload:unknown,work:(tx:Prisma.TransactionClient)=>Promise<CommandResponse>,retentionMs=7*86400_000):Promise<CommandResponse>{
 if(!key||!(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i).test(key))return {status:400,body:{error:'A client-generated UUID idempotency key is required.'}};
 const requestHash=createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
 for(let attempt=0;;attempt++){
  try{return await db.$transaction(async tx=>{
   const old=await tx.commandReceipt.findUnique({where:{actorId_scope_key:{actorId,scope,key}}});
   if(old)return old.requestHash===requestHash?old.response as unknown as CommandResponse:{status:409,body:{error:'This command key was already used for a different request.'}};
   const result=JSON.parse(JSON.stringify(await work(tx))) as CommandResponse;
   await tx.commandReceipt.create({data:{actorId,scope,key,requestHash,response:result as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+retentionMs)}});
   return result;
  },{isolationLevel:'Serializable',maxWait:10_000,timeout:25_000});}
  catch(error){
   if(attempt>=4||!(serializationConflict(error)||error instanceof ConcurrentGameWrite||(error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(error.code))))throw error;
   await new Promise(resolve=>setTimeout(resolve,10*(attempt+1)));
  }
 }
}

export function commandHttp(result:CommandResponse){return NextResponse.json(result.body,{status:result.status,headers:{'cache-control':'private, no-store',...result.headers}});}
export function commandLimited(retryAfter:number):CommandResponse{return {status:429,body:{error:'Too many requests.'},headers:{'retry-after':String(retryAfter)}};}
