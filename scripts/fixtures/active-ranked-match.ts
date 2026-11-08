import type {Prisma} from '@prisma/client';
import {createProposedRankedMatch,transitionMatch} from '../../backend/src/lib/match-state';
/** Test arrangement for crash/restart at an already active hand; not shipped as a runtime helper. */
export async function createActiveRankedMatch(tx:Prisma.TransactionClient,players:{id:string;rating:number;rd:number;volatility:number;rated:number}[],now:Date){
 const id=await createProposedRankedMatch(tx,players,now);
 if(!await transitionMatch(tx,id,'PROPOSED','READY')||!await transitionMatch(tx,id,'READY','ACTIVE',{handNumber:1,startedAt:now}))throw new Error('Fixture startup conflict.');
 await tx.match.update({where:{id},data:{readyDeadlineAt:null}});
 return id;
}
