import {workerSecret} from '../src/lib/server/worker-auth.mjs';
const secret=workerSecret(process.env.SESSION_SECRET);
const port=process.env.PORT??'4000';
if(!/^\d+$/.test(port))throw new Error('Invalid local backend port.');
let stopping=false;
const shutdown=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;shutdown.abort();});
while(!stopping){
 try{
  const response=await fetch(`http://127.0.0.1:${port}/api/internal/tick`,{method:'POST',headers:{'x-elo-proxy-secret':process.env.BACKEND_PROXY_SECRET??'','x-elo-worker-secret':secret},signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(25_000)])});
  if(!response.ok)throw new Error('tick unavailable');
  const result=await response.json();
  if(result.processed||result.expired||result.queueReleased)console.log(JSON.stringify({event:'deadline_worker_cycle',...result}));
 }catch{if(!stopping)console.error(JSON.stringify({event:'deadline_worker_retry'}));}
 if(!stopping)await new Promise(resolve=>setTimeout(resolve,1000));
}
