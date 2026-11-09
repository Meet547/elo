import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
try{
 assert.equal(await db.player.count(),0,'each integration command must receive a fresh database');
 await db.player.create({data:{id:'harness-isolation-fixture',name:'Harness fixture'}});
}finally{await db.$disconnect();}
