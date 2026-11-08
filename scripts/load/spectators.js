/* global __ENV, __VU */
import sse from 'k6/x/sse';
import http from 'k6/http';
import {check} from 'k6';
import {Rate,Trend,Counter} from 'k6/metrics';
const fixture=JSON.parse(open(__ENV.ELO_LOAD_FIXTURE));
const latency=new Trend('action_to_event_ms',true);
const failures=new Rate('spectator_failures');
const delivered=new Counter('delivered_updates');
export const options={scenarios:{spectators:{executor:'per-vu-iterations',vus:500,iterations:1,maxDuration:'45s'}},thresholds:{spectator_failures:['rate<0.01'],action_to_event_ms:['p(95)<=1000'],delivered_updates:['count==500']}};
export default function spectator(){
 let received=false,ready=false;
 const response=sse.open(`${fixture.origin}/api/live/${fixture.code}/events`,{headers:{Cookie:fixture.cookies[__VU-1],'x-elo-proxy-secret':fixture.proxySecret},timeout:'35s'},client=>{
  client.on('event',event=>{
   const value=JSON.parse(event.data);
   if(value.revision===0&&!ready){ready=true;http.post(`${fixture.coordinator}/ready/${__VU}`);}
   if(value.revision===1&&!received){
    const at=Date.now();received=true;
    const timing=http.get(`${fixture.coordinator}/timing`).json();
    latency.add(at-timing.startedAt);delivered.add(1);client.close();
   }
  });
 });
 failures.add(!received||!response||response.status!==200);
 check(response,{'stream opened and update received':r=>r&&r.status===200&&received});
}
