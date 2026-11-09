const storageKey='elo_pending_game_commands_v1';
const pending=new Map<string,{key:string;at:number}>();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function restore(){
 try{
  if(typeof sessionStorage==='undefined')return;
  const rows=JSON.parse(sessionStorage.getItem(storageKey)??'[]');
  if(Array.isArray(rows))for(const entry of rows.slice(-100)){
   if(Array.isArray(entry)&&typeof entry[0]==='string'&&entry[1]&&uuid.test(entry[1].key)&&Number.isFinite(entry[1].at)&&Date.now()-entry[1].at<7*86400_000)pending.set(entry[0],entry[1]);
  }
 }catch{/* Storage is optional; an in-memory intent survives ordinary retries. */}
}
function save(){
 while(pending.size>100)pending.delete(pending.keys().next().value!);
 try{if(typeof sessionStorage!=='undefined')sessionStorage.setItem(storageKey,JSON.stringify([...pending]));}catch{}
}
restore();
/** Unknown results retain the intent across manual retries and same-tab reloads. */
export async function postGameCommand(url:string,payload:unknown,options:{key?:string;fetcher?:typeof fetch;signal?:AbortSignal;owner?:string}={}){
 const body=JSON.stringify(payload);
 const identity=JSON.stringify([options.owner??'',url,body]);
 const key=options.key??pending.get(identity)?.key??crypto.randomUUID();
 if(!options.key){pending.set(identity,{key,at:Date.now()});save();}
 const request=options.fetcher??fetch;
 for(let attempt=0;;attempt++){
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  try{
   const response=await request(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':key},body,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(12_000)]):AbortSignal.timeout(12_000)});
   if(attempt===0&&[502,503,504].includes(response.status)){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,250));continue;}
   if(response.ok){
    // Headers alone are not an acknowledgement: a dropped/truncated JSON body is unknown.
    await response.clone().json();
   }
   if((response.ok||(response.status>=400&&response.status<500))&&!options.key){pending.delete(identity);save();}
   return response;
  }catch(error){if(options.signal?.aborted||attempt>=1)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
 }
}
