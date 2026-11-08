import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PrismaClient} from '@prisma/client';
import {isolatedDatabaseUrl} from '../lib/test-database.mjs';

const date=value=>new Date(typeof value==='bigint'?Number(value):value);
const canonical=value=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const fingerprint=rows=>createHash('sha256').update(canonical(rows)).digest('hex');
export function readLegacy(filename){
 const source=new DatabaseSync(resolve(filename),{readOnly:true});
 try{
  source.exec('PRAGMA query_only=ON');
  const read=table=>{
   if(!source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))return [];
   return source.prepare(`SELECT * FROM "${table}"`).all();
  };
  if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity check failed.');
  const players=read('Player').map(({isRival,...row})=>({...row,isSimulated:Boolean(isRival),createdAt:date(row.createdAt),lastSeen:date(row.lastSeen)}));
  const sessions=read('Session').map(row=>({...row,mode:'LEGACY',createdAt:date(row.createdAt)}));
  const rooms=read('LiveRoom').map(row=>{const state=JSON.parse(row.state);return {...row,expiresAt:date(row.expiresAt),nextDeadlineAt:state.nextAt==null?null:date(state.nextAt)};});
  const queue=read('RankedSeat').map(row=>({...row,joinedAt:date(row.joinedAt),seenAt:date(row.seenAt)}));
  // New ranked settlement requires a reviewed, frozen match snapshot; never invent it.
  if(rooms.some(row=>JSON.parse(row.state).ranked))throw new Error('Legacy ranked room requires explicit match/participant mapping before import. Source is unchanged.');
  const ids=new Set(players.map(row=>row.id));
  if(sessions.some(row=>!ids.has(row.playerId))||queue.some(row=>!ids.has(row.playerId)))throw new Error('Legacy snapshot has orphaned player references.');
  return {players,sessions,rooms,queue};
 }finally{source.close();}
}
const fields={
 players:['id','name','rating','rd','volatility','rated','peak','hands','cashes','netChips','biggestPot','streak','isSimulated','createdAt','lastSeen'],
 sessions:['id','playerId','hands','buyIn','finalStack','net','place','seats','ratingBefore','ratingAfter','biggestPot','potsWon','bestHand','exit','createdAt','mode'],
 rooms:['code','revision','state','expiresAt','nextDeadlineAt'],queue:['playerId','rating','joinedAt','seenAt','roomCode'],
};
export function summary(data){
 return Object.fromEntries(Object.entries(fields).map(([kind,keys])=>{
  const rows=data[kind].map(row=>Object.fromEntries(keys.map(key=>[key,row[key]??null]))).sort((a,b)=>String(a.id??a.code??a.playerId).localeCompare(String(b.id??b.code??b.playerId)));
  return [kind,{count:rows.length,sha256:fingerprint(rows)}];
 }));
}
export async function targetSummary(client){
 return summary({players:await client.player.findMany(),sessions:await client.session.findMany(),rooms:await client.liveRoom.findMany(),queue:await client.rankedSeat.findMany()});
}
export async function importLegacy(client,data){
 return client.$transaction(async tx=>{
  const counts=await Promise.all([tx.player.count(),tx.session.count(),tx.liveRoom.count(),tx.rankedSeat.count(),tx.match.count(),tx.authSession.count(),tx.externalIdentity.count(),tx.oAuthAttempt.count(),tx.rateWindow.count(),tx.commandReceipt.count()]);
  if(counts.some(Boolean))throw new Error('Import requires an empty application database. No existing data will be overwritten.');
  if(data.players.length)await tx.player.createMany({data:data.players});
  if(data.sessions.length)await tx.session.createMany({data:data.sessions});
  if(data.rooms.length)await tx.liveRoom.createMany({data:data.rooms});
  if(data.queue.length)await tx.rankedSeat.createMany({data:data.queue});
  const expected=summary(data),actual=await targetSummary(tx);
  if(canonical(expected)!==canonical(actual))throw new Error('Import count/hash mismatch; rolling back all application rows.');
  return actual;
 },{isolationLevel:'Serializable',timeout:60_000});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/migration/import-sqlite.mjs <private-backup.db> [--dry-run]');
 const data=readLegacy(input);
 if(process.argv.includes('--dry-run'))console.log(JSON.stringify({dryRun:true,tables:summary(data)},null,2));
 else{
  isolatedDatabaseUrl(process.env.DATABASE_URL);
  const client=new PrismaClient();
  try{console.log(JSON.stringify({isolatedImport:true,tables:await importLegacy(client,data)},null,2));}finally{await client.$disconnect();}
 }
}
