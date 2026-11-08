import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {NextRequest} from 'next/server';
import {db} from '../backend/src/lib/db';
import {beginGoogle,consumeGoogleAttempt,linkGoogleIdentity,accountIdentity,googleIdentity} from '../backend/src/lib/google-auth';
import {GET as capabilities} from '../backend/src/app/api/auth/config/route';
import {GET as googleStart} from '../backend/src/app/api/auth/google/route';
import {isolatedDatabaseUrl} from './lib/test-database.mjs';
assert.equal(process.env.ELO_TEST_DATABASE,'1');isolatedDatabaseUrl(process.env.DATABASE_URL);
process.env.GOOGLE_CLIENT_ID='fixture-client';process.env.GOOGLE_CLIENT_SECRET='fixture-only';process.env.NEXT_PUBLIC_SITE_URL='https://front.example';
try{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const originalCerts=OAuth2Client.prototype.getFederatedSignonCertsAsync;
 const originalFetch=globalThis.fetch;
 Object.defineProperty(OAuth2Client.prototype,'getFederatedSignonCertsAsync',{value:async()=>({certs:{fixture:publicKey.export({type:'spki',format:'pem'}).toString()},format:'PEM'}),configurable:true,writable:true});
 const now=Math.floor(Date.now()/1000);
 function token(overrides:Record<string,unknown>={}){
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:'fixture-client',sub:'signed-subject',email:'verified@fixture.example',email_verified:true,nonce:'bound-nonce',iat:now,exp:now+3600,...overrides})).toString('base64url');
  const unsigned=header+'.'+payload;
  return unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
 }
 let issued=token();
 globalThis.fetch=(async()=>Response.json({id_token:issued})) as typeof fetch;
 try{
  assert.equal((await googleIdentity('code','verifier','bound-nonce')).subject,'signed-subject');
  await assert.rejects(googleIdentity('code','verifier','wrong-nonce'));
  issued=token({aud:'another-client'});await assert.rejects(googleIdentity('code','verifier','bound-nonce'));
  issued=token({email_verified:false});await assert.rejects(googleIdentity('code','verifier','bound-nonce'));
  issued=token({exp:now-3600});await assert.rejects(googleIdentity('code','verifier','bound-nonce'));
  issued=token().slice(0,-12)+'tampered';await assert.rejects(googleIdentity('code','verifier','bound-nonce'));
 }finally{globalThis.fetch=originalFetch;OAuth2Client.prototype.getFederatedSignonCertsAsync=originalCerts;}
 console.log('PASS — signed identity token, audience, expiry, signature, verified email and nonce boundaries');
 const player=await db.player.create({data:{name:'Guest with history',hands:45,rated:8}});
 const first=await beginGoogle(player.id);const url=new URL(first.url);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('redirect_uri'),'https://front.example/api/auth/google/callback');
 const state=url.searchParams.get('state')!;
 await assert.rejects(consumeGoogleAttempt(state,'wrong-browser'));
 const attempt=await consumeGoogleAttempt(state,first.browser);assert.equal(attempt.playerId,player.id);assert(attempt.nonce&&attempt.verifier);
 await assert.rejects(consumeGoogleAttempt(state,first.browser),/expired|used/);
 const second=await beginGoogle(null);await db.oAuthAttempt.updateMany({data:{expiresAt:new Date(0)}});
 await assert.rejects(consumeGoogleAttempt(new URL(second.url).searchParams.get('state')!,second.browser),/expired/);
 const subject={subject:'fixture-subject',email:'admin@fixture.example'};
 assert.equal(await linkGoogleIdentity(subject,player.id),player.id);
 assert.equal(await linkGoogleIdentity(subject,null),player.id,'cross-device provider sign-in restores original player');
 assert.equal((await db.player.findUniqueOrThrow({where:{id:player.id}})).hands,45);
 assert.equal(await db.externalIdentity.count({where:{playerId:player.id}}),1);
 await assert.rejects(linkGoogleIdentity({subject:'other-subject',email:subject.email},player.id),/already has/);
 const unrelated=await linkGoogleIdentity({subject:'different-subject',email:subject.email},null);
 assert.notEqual(unrelated,player.id,'matching email alone must never merge account histories');
 process.env.ADMIN_EMAILS=subject.email;
 assert.deepEqual(await accountIdentity(player.id),{verified:true,administrator:true,providers:['google']});
 const guest=await db.player.create({data:{name:'admin@fixture.example'}});
 assert.equal((await accountIdentity(guest.id)).administrator,false);
 assert.deepEqual(await capabilities().json(),{google:true});
 const live=await googleStart(new NextRequest('https://front.example/api/auth/google'));
 assert.equal(live.status,303);assert(live.headers.get('set-cookie')?.includes('HttpOnly'));
 delete process.env.GOOGLE_CLIENT_SECRET;
 assert.deepEqual(await capabilities().json(),{google:false},'public capability response exposes no secrets and hides unconfigured sign-in');
 assert.equal((await googleStart(new NextRequest('https://front.example/api/auth/google'))).status,503,'unconfigured provider must not fake sign-in');
 console.log('PASS — PKCE/state/browser binding, expiry, replay protection, account restoration, guest-ID preservation and verified admin allowlist');
}finally{await db.$disconnect();}
