import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../backend/src/lib/db';
import {updateRankedQueue} from '../backend/src/lib/ranked-queue';
import {PROVISIONAL_SESSIONS} from '../src/lib/rating';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
try{
 const make=async(verified:boolean,rated=0)=>{
  const id=randomUUID();return db.player.create({data:{id,name:'Fixture '+id.slice(0,6),nameKey:id,rated,rankedPlacements:rated,...(verified?{identities:{create:{provider:'google',subject:id,email:`${id}@fixture.example`}}}:{})}});
 };
 const guest=await make(false);
 await assert.rejects(updateRankedQueue(guest.id,'join'),/verified|verify/i,'A4: guests must not enter ranked by calling the service directly');
 assert.equal(await db.rankedSeat.count({where:{playerId:guest.id}}),0);
 const newcomer=await make(true),veteran=await make(true,PROVISIONAL_SESSIONS);
 assert.equal((await updateRankedQueue(newcomer.id,'join'))?.status,'searching');
 assert.equal((await updateRankedQueue(veteran.id,'join'))?.status,'searching','placement and established pools must not mix');
 const second=await make(true);assert.equal((await updateRankedQueue(second.id,'join'))?.status,'matched');
 const historical=await make(true);await db.player.update({where:{id:historical.id},data:{rated:100}});
 await updateRankedQueue(historical.id,'join');assert.equal((await db.rankedSeat.findUniqueOrThrow({where:{playerId:historical.id}})).pool,'PLACEMENT','legacy rated history must not bypass new ranked placements');
 const legacy=await make(true);await db.player.update({where:{id:legacy.id},data:{nameKey:null}});
 await assert.rejects(updateRankedQueue(legacy.id,'join'),/name/i);
 console.log('PASS — verified identity, claimed unique name and separate placement pools are enforced inside matchmaking');
}finally{await db.$disconnect();}
