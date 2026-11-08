import assert from 'node:assert/strict';
import {randomSeedHex} from '../src/lib/poker/rng';
assert.match(randomSeedHex(),/^[a-f0-9]{64}$/);
const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
try{
 Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
 assert.throws(()=>randomSeedHex(),/secure randomness/i,'shuffle creation must fail closed without a CSPRNG');
}finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else Reflect.deleteProperty(globalThis,'crypto');}
console.log('PASS — missing cryptographic randomness fails closed without a weak shuffle');
