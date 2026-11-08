import type {Prisma,PrismaClient} from '@prisma/client';
export type DatabaseClient=PrismaClient|Prisma.TransactionClient;
export const ownsTransaction=(client:DatabaseClient):client is PrismaClient=>'$transaction' in client;
export async function inTransaction<T>(client:DatabaseClient,work:(tx:Prisma.TransactionClient)=>Promise<T>,options:{isolationLevel?:Prisma.TransactionIsolationLevel;maxWait?:number;timeout?:number}={}){
 return ownsTransaction(client)?client.$transaction(work,{isolationLevel:'Serializable',...options}):work(client);
}

export class ConcurrentGameWrite extends Error {}
