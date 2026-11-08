import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {db} from './db';
import {displayName} from './display-name';

export const oauthCookie='elo_oauth_browser';
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
export function googleConfig() {
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const site=process.env.NEXT_PUBLIC_SITE_URL;
  if(!clientId||!clientSecret||!site) throw new Error('Google sign-in is not configured.');
  const origin=new URL(site);
  if(origin.origin!==site.replace(/\/$/, '')|| (origin.protocol!=='https:'&&process.env.NODE_ENV==='production')) throw new Error('Invalid public origin.');
  return {clientId,clientSecret,redirectUri:`${origin.origin}/api/auth/google/callback`,origin:origin.origin};
}
export async function beginGoogle(playerId:string|null) {
  const config=googleConfig();
  const state=random(),browser=random(),nonce=random(),verifier=random();
  await db.oAuthAttempt.create({data:{stateHash:digest(state),browserHash:digest(browser),nonce,verifier,playerId,expiresAt:new Date(Date.now()+10*60_000)}});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.toString(),browser};
}
export async function consumeGoogleAttempt(state:string,browser:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new Error('Invalid sign-in state.');
  const attempt=await db.oAuthAttempt.findUnique({where:{stateHash:digest(state)}});
  if(!attempt||attempt.browserHash!==digest(browser)||attempt.expiresAt.getTime()<=Date.now()) throw new Error('Sign-in expired or belongs to another browser.');
  const claimed=await db.oAuthAttempt.deleteMany({where:{stateHash:attempt.stateHash,browserHash:attempt.browserHash,expiresAt:{gt:new Date()}}});
  if(claimed.count!==1) throw new Error('Sign-in already used.');
  return attempt;
}
export async function googleIdentity(code:string,verifier:string,nonce:string) {
  const config=googleConfig();
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code',code_verifier:verifier}),signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error('Google rejected the sign-in.');
  const tokens=await response.json();
  if(typeof tokens.id_token!=='string')throw new Error('Missing identity token.');
  const ticket=await new OAuth2Client(config.clientId).verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
  const identity=ticket.getPayload();
  if(!identity||identity.nonce!==nonce||identity.email_verified!==true||!identity.email||!identity.sub)throw new Error('Unverified Google identity.');
  return {subject:identity.sub,email:identity.email.toLowerCase()};
}
/** Provider subject is the identity key; email alone never links or merges players. */
export async function linkGoogleIdentity(identity:{subject:string;email:string},guestId:string|null) {
  return db.$transaction(async(tx)=>{
    const existing=await tx.externalIdentity.findUnique({where:{provider_subject:{provider:'google',subject:identity.subject}},include:{player:true}});
    if(existing){
      if(existing.player.deletedAt)throw new Error('Account unavailable.');
      if(guestId&&guestId!==existing.playerId&&await tx.externalIdentity.count({where:{playerId:guestId}}))throw new Error('Sign out before switching verified accounts.');
      await tx.externalIdentity.update({where:{provider_subject:{provider:"google",subject:identity.subject}},data:{email:identity.email,verifiedAt:new Date()}});
      return existing.playerId;
    }
    const guest=guestId?await tx.player.findUnique({where:{id:guestId,deletedAt:null,isSimulated:false}}):null;
    if(guest&&await tx.externalIdentity.count({where:{playerId:guest.id,provider:'google'}}))throw new Error('This player already has a Google identity.');
    const player=guest??await tx.player.create({data:displayName(`Player ${randomBytes(4).toString('hex')}`)});
    await tx.externalIdentity.create({data:{provider:'google',subject:identity.subject,email:identity.email,playerId:player.id}});
    return player.id;
  },{isolationLevel:'Serializable'});
}
export async function accountIdentity(playerId:string) {
  const identities=await db.externalIdentity.findMany({where:{playerId},select:{provider:true,email:true}});
  const admins=(process.env.ADMIN_EMAILS??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
  return {verified:identities.length>0,administrator:identities.some(identity=>admins.includes(identity.email.toLowerCase())),providers:identities.map(identity=>identity.provider)};
}
