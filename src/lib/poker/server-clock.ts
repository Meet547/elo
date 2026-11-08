/** Midpoint estimate: server timestamp and both client observations use milliseconds. */
export function serverClockOffset(serverNow:number,sentAt:number,receivedAt:number){
 if(![serverNow,sentAt,receivedAt].every(Number.isFinite)||receivedAt<sentAt)throw new Error('Invalid clock sample.');
 return serverNow-(sentAt+receivedAt)/2;
}
export function secondsToDeadline(deadline:number,clientNow:number,offset:number,maxSeconds:number){
 return Math.max(0,Math.min(maxSeconds,Math.ceil((deadline-clientNow-offset)/1000)));
}
