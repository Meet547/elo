import {createHmac,timingSafeEqual} from 'node:crypto';
export function workerSecret(secret){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Worker requires a stable session secret.');
 return createHmac('sha256',secret).update('elo-deadline-worker-v1').digest('hex');
}
export function verifyWorkerSecret(supplied,secret){
 if(typeof supplied!=='string')return false;
 const expected=workerSecret(secret);
 return supplied.length===expected.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}
