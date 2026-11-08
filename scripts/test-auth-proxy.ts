import assert from 'node:assert/strict';
import {forwardApi} from '../src/lib/server/api-proxy';
const original=globalThis.fetch;
process.env.BACKEND_ORIGIN='https://backend.example';process.env.BACKEND_PROXY_SECRET='test-only';
try{
 globalThis.fetch=(async()=>new Response(null,{status:303,headers:{location:'https://accounts.google.com/o/oauth2/v2/auth?state=test'}})) as typeof fetch;
 const response=await forwardApi(new Request('https://front.example/api/auth/google'),['auth','google']);
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),'https://accounts.google.com/o/oauth2/v2/auth?state=test','OAuth redirects must cross the same-origin proxy');
}finally{globalThis.fetch=original;}
