"use client";

import {useEffect,useState} from 'react';
import {TactileButton} from '@/components/felt/kit';

type Account={verified:boolean;providers:string[];googleAvailable:boolean};
export function AccountAccess(){
 const [account,setAccount]=useState<Account|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/account',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Could not load account settings.');
   setAccount(await response.json());
  }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
  return()=>controller.abort();
 },[]);
 async function logout(all:boolean){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({all})});
   if(!response.ok)throw new Error('Could not sign out. Please retry.');
   window.location.reload();
  }catch(error){setError(error instanceof Error?error.message:'Could not sign out.');setBusy(false);}
 }
 return <section className="elo-panel space-y-3 p-5" aria-label="Account access">
  <h2 className="font-display text-2xl">Your account</h2>
  {account&&<p className="text-sm text-ink-soft">{account.verified?'Your profile is connected to Google.':account.googleAvailable?'Connect Google to recover your profile on another device.':'Keep this browser to return to your guest profile. Account recovery will be available soon.'}</p>}
  {account?.googleAvailable&&<a href="/api/auth/google" className="inline-flex min-h-11 items-center underline">{account.verified?'Continue with Google':'Connect Google'}</a>}
  {account?.verified&&<div className="flex flex-wrap gap-3">
    <TactileButton disabled={busy} onClick={()=>void logout(false)}>Sign out</TactileButton>
    <TactileButton disabled={busy} onClick={()=>void logout(true)}>Sign out all devices</TactileButton>
  </div>}
  {error&&<p role="alert" className="text-sm text-carmine-deep">{error}</p>}
 </section>;
}
