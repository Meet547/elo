import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
function hit(ip:string,bucket:string,actor:string){
 const child=spawnSync(process.execPath,['--conditions=react-server','scripts/fixtures/rate-limit-child.ts',ip,bucket,actor],{env:process.env,encoding:'utf8',timeout:20_000});
 assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout.trim());
}
assert.equal(hit('fixture-ip-a','persistent-account','actor-a').ok,true);
assert.equal(hit('fixture-ip-b','persistent-account','actor-a').ok,false,'account limit must survive process restart and IP rotation');
assert.equal(hit('fixture-ip-a','persistent-ip','actor-a').ok,true);
assert.equal(hit('fixture-ip-a','persistent-ip','actor-b').ok,false,'IP limit must survive process restart and account rotation');
console.log('PASS — persistent account and IP mutation limits survive process restart');

const {db}=await import('../backend/src/lib/db');
const {rateLimit}=await import('../backend/src/lib/rate-limit');
const {NextRequest}=await import('next/server');
try{
 const req=new NextRequest('https://fixture.example/api/account',{method:'POST',headers:{'x-elo-client-ip':'concurrent-fixture'}});
 const hits=await Promise.all(Array.from({length:16},()=>rateLimit(req,'parallel-limit',4,60000,'parallel-actor')));
 assert.equal(hits.filter(hit=>hit.ok).length,4,'concurrent mutation limit must be atomic');
 const rows=await db.rateWindow.findMany();assert(rows.every(row=>/^[a-f0-9]{64}$/.test(row.key)),'raw IPs/account IDs must never be persisted in limit keys');
 console.log('PASS — atomic concurrent limit and hashed privacy-preserving keys');
}finally{await db.$disconnect();}
