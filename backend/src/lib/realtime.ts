import 'server-only';
import {Client} from 'pg';
import type {LiveRoom,RoomEvent} from '@prisma/client';
import {db} from './db';
import {readLiveRoom,processRoomDeadline} from './live-rooms';
import {publicLiveTable,type LiveTable} from '@/lib/poker/live-table';

export type StreamIdentity={actorId:string;tag:string;legacy:boolean};
export type RoomObserver={identity:StreamIdentity;update:(row:LiveRoom)=>void;close:()=>void};
type QueueObserver = { identity: StreamIdentity; changed: () => void; close: () => void };

class NotificationBus {
 private client:Client|null=null;
 private opening:Promise<void>|null=null;
 private connected=false;
 private enabled=false;
 private retry:ReturnType<typeof setTimeout>|undefined;
 constructor(private receive:(channel:string,payload:string)=>void,private lost:()=>void,private resync:()=>void){}
 async ready():Promise<void>{
  this.enabled=true;
  if(this.connected)return;
  if(this.opening)return this.opening;
  const url=process.env.DIRECT_DATABASE_URL??process.env.DATABASE_URL;
  if(!url)throw new Error('Direct Postgres connection is required.');
  const parsed=new URL(url);
  if(parsed.hostname.endsWith('.neon.tech')&&parsed.hostname.includes('-pooler'))throw new Error('Realtime requires the unpooled direct connection.');
  const client=new Client({connectionString:url,application_name:'elo-realtime',connectionTimeoutMillis:5000,keepAlive:true});
  this.client=client;
  const disconnected=()=>{
   if(this.client!==client)return;
   this.connected=false;this.client=null;void client.end().catch(()=>{});this.lost();
   if(this.enabled&&!this.retry)this.retry=setTimeout(()=>{this.retry=undefined;void this.ready().catch(()=>{});},1000);
  };
  client.on('error',disconnected);client.on('end',disconnected);
  client.on('notification',message=>{if(message.channel&&message.payload)this.receive(message.channel,message.payload);});
  const opening=(async()=>{
   try{
    await client.connect();
    await client.query('LISTEN elo_room_events');await client.query('LISTEN elo_auth_events');
    await client.query('LISTEN elo_queue_events');
    if(this.client!==client||!this.enabled)throw new Error('Listener replaced.');
    this.connected=true;this.resync();
   }catch(error){disconnected();throw error;}
  })();
  this.opening=opening;
  try{await opening;}finally{if(this.opening===opening)this.opening=null;}
 }
 async stop(){
  this.enabled=false;this.connected=false;this.opening=null;clearTimeout(this.retry);this.retry=undefined;
  const client=this.client;this.client=null;
  if(client)await client.end().catch(()=>{});
 }
}

export class RoomHub {
 row:LiveRoom|null=null;
 table:LiveTable|null=null;
 readonly observers=new Set<RoomObserver>();
 private refreshing:Promise<void>|null=null;
 private dirty=false;
 private idleTimer:ReturnType<typeof setTimeout>|undefined;
 private heartbeat:ReturnType<typeof setInterval>|undefined;
 private replayCache=new Map<string,Promise<RoomEvent[]>>();
 private frames=new Map<number,string>();
 private presenceBusy=false;
 constructor(readonly code:string,private owner:Realtime){ }
 async refresh(){
  this.dirty=true;
  if(this.refreshing)return this.refreshing;
  this.refreshing=(async()=>{
   do{
    this.dirty=false;
    const row=await db.liveRoom.findUnique({where:{code:this.code}});
    if(!row||row.expiresAt.getTime()<=Date.now()){this.row=null;this.table=null;this.closeAll();break;}
    const changed=!this.row||this.row.revision!==row.revision;
    this.row=row;this.table=JSON.parse(row.state) as LiveTable;
    if(changed){this.frames.clear();this.replayCache.clear();for(const observer of this.observers)observer.update(row);}
   }while(this.dirty);
  })();
  try{await this.refreshing;}catch(error){this.closeAll();throw error;}finally{this.refreshing=null;}
 }
 frame(row:LiveRoom,actorId:string){
  const current=row.revision===this.row?.revision;
  const table=current?this.table!:JSON.parse(row.state) as LiveTable;
  const seat=table.players.findIndex(player=>player.id===actorId);
  if(current&&this.frames.has(seat))return this.frames.get(seat)!;
  const text=`id: ${row.revision}\ndata: ${JSON.stringify(publicLiveTable(table,actorId,this.code,row.revision))}\n\n`;
  if(current)this.frames.set(seat,text);
  return text;
 }
 async prepare(actorId:string){
  if(this.table?.ranked&&!this.observers.size){await readLiveRoom(this.code,actorId);await this.refresh();}
 }
 observe(observer:RoomObserver){
  clearTimeout(this.idleTimer);this.observers.add(observer);
  if(!this.heartbeat)this.heartbeat=setInterval(()=>{void this.touchPresence();},5000);
  return ()=>{this.observers.delete(observer);this.idle();};
 }
 private async touchPresence(){
  if(this.presenceBusy||!this.table?.ranked||this.table.status!=='playing'||!this.row?.matchId)return;
  this.presenceBusy=true;
  try{
   await processRoomDeadline(this.code);
   const ids=[...new Set([...this.observers].map(observer=>observer.identity.actorId))];
   if(ids.length)await db.matchParticipant.updateMany({where:{matchId:this.row.matchId,playerId:{in:ids},match:{state:'ACTIVE'}},data:{lastSeenAt:new Date()}});
  }catch{this.closeAll();}finally{this.presenceBusy=false;}
 }
 async replay(after:number,through:number){
  const key=`${after}:${through}`;
  if(!this.replayCache.has(key)){
   while(this.replayCache.size>=8)this.replayCache.delete(this.replayCache.keys().next().value!);
   this.replayCache.set(key,db.roomEvent.findMany({where:{roomCode:this.code,revision:{gt:after,lte:through}},orderBy:{revision:'asc'},take:129}).catch(error=>{this.replayCache.delete(key);throw error;}));
  }
  return this.replayCache.get(key)!;
 }
 idle(){
  if(this.observers.size)return;
  clearInterval(this.heartbeat);this.heartbeat=undefined;clearTimeout(this.idleTimer);
  this.idleTimer=setTimeout(()=>this.owner.remove(this),2000);
 }
 closeAll(){for(const observer of [...this.observers])observer.close();this.idle();}
 dispose(){clearTimeout(this.idleTimer);clearInterval(this.heartbeat);for(const observer of [...this.observers])observer.close();clearTimeout(this.idleTimer);}
}
class Realtime {
 readonly hubs=new Map<string,RoomHub>();
 private queueObservers = new Set<QueueObserver>();
 private revokedTags=new Set<string>();
 private revokedActors=new Set<string>();
 private revokedLegacy=new Set<string>();
 private reconciling=false;
 private watchdog:ReturnType<typeof setInterval>|undefined;
 readonly bus=new NotificationBus((channel,payload)=>this.receive(channel,payload),()=>{for(const hub of this.hubs.values())hub.closeAll();
  for (const observer of [...this.queueObservers]) observer.close();
 },()=>{void this.reconcile();});
 revoked(identity:StreamIdentity){return this.revokedTags.has(identity.tag)||this.revokedActors.has(identity.actorId)||(identity.legacy&&this.revokedLegacy.has(identity.actorId));}
 private receive(channel:string,payload:string){
  let message;try{message=JSON.parse(payload);}catch{return;}
  if(channel==='elo_room_events'&&typeof message.code==='string'){
   const hub=this.hubs.get(message.code);
   if(message.deleted&&hub){hub.row=null;hub.table=null;hub.closeAll();}else if(hub)void hub.refresh().catch(()=>{});
  }else if(channel==='elo_queue_events'){
   for (const observer of this.queueObservers) {
    if (observer.identity.actorId === message.actorId) observer.changed();
   }
  }else if(channel==='elo_auth_events'){
   if(message.type==='session'&&typeof message.tag==='string')this.revokedTags.add(message.tag);
   if(message.type==='actor'&&typeof message.actorId==='string')this.revokedActors.add(message.actorId);
   if(message.type==='legacy-actor'&&typeof message.actorId==='string')this.revokedLegacy.add(message.actorId);
   for(const set of [this.revokedTags,this.revokedActors,this.revokedLegacy])while(set.size>10000)set.delete(set.values().next().value!);
   for(const hub of this.hubs.values())for(const observer of [...hub.observers])if(this.revoked(observer.identity))observer.close();
   for (const observer of [...this.queueObservers]) if (this.revoked(observer.identity)) observer.close();
  }
 }
 async get(code:string){
  let hub=this.hubs.get(code);
  if(!hub){hub=new RoomHub(code,this);this.hubs.set(code,hub);}
  try{
   await this.bus.ready();
   if(!hub.row||hub.row.expiresAt.getTime()<=Date.now())await hub.refresh();
   if(!this.watchdog)this.watchdog=setInterval(()=>{void this.reconcile();},5000);
   hub.idle();return hub.row?hub:null;
  }catch(error){hub.idle();throw error;}
 }
 private async reconcile(){
  if(this.reconciling||!this.hubs.size)return;
  this.reconciling=true;
  try{
   const rows=await db.liveRoom.findMany({where:{code:{in:[...this.hubs.keys()]}},select:{code:true,revision:true,expiresAt:true}});
   for(const hub of this.hubs.values()){
    const row=rows.find(row=>row.code===hub.code);
    if(!row||row.expiresAt.getTime()<=Date.now()){hub.row=null;hub.table=null;hub.closeAll();}
    else if(row.revision!==hub.row?.revision)void hub.refresh().catch(()=>{});
   }
  }catch{for(const hub of this.hubs.values())hub.closeAll();}finally{this.reconciling=false;}
 }
 remove(hub:RoomHub){
  if(hub.observers.size||this.hubs.get(hub.code)!==hub)return;
  hub.dispose();this.hubs.delete(hub.code);
  this.stopIfIdle();
 }
 watchQueue(observer: QueueObserver) {
  this.queueObservers.add(observer);
  return {
   ready: this.bus.ready(),
   unsubscribe: () => {
    this.queueObservers.delete(observer);
    this.stopIfIdle();
   },
  };
 }
 private stopIfIdle() {
  if (this.hubs.size || this.queueObservers.size) return;
  clearInterval(this.watchdog);
  this.watchdog = undefined;
  void this.bus.stop();
  this.revokedTags.clear();
  this.revokedActors.clear();
  this.revokedLegacy.clear();
 }
 async shutdown(){
  for (const observer of [...this.queueObservers]) observer.close();
  for(const hub of this.hubs.values())hub.dispose();this.hubs.clear();clearInterval(this.watchdog);this.watchdog=undefined;await this.bus.stop();
 }
}
const processGlobal=globalThis as typeof globalThis&{__eloRealtimeV1?:Realtime};
export const realtime=processGlobal.__eloRealtimeV1??=new Realtime();
export const shutdownRealtime=()=>realtime.shutdown();
