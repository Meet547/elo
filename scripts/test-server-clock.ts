import assert from 'node:assert/strict';
import {serverClockOffset,secondsToDeadline} from '../src/lib/poker/server-clock';
// Client is five minutes ahead; 200 ms round-trip, timestamp at midpoint.
const offset=serverClockOffset(100000,399900,400100);
assert.equal(offset,-300000);assert.equal(secondsToDeadline(115000,400000,offset,15),15);
assert.equal(secondsToDeadline(115000,414001,offset,15),1);
assert.equal(secondsToDeadline(115000,415000,offset,15),0);
assert.throws(()=>serverClockOffset(1,3,2));
console.log('PASS — ready/action countdowns use a measured server clock offset and clamp expired deadlines');
