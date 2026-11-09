"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Shell} from './Shell';
import {verifyCardProof} from '@/lib/poker/fair-deck';
import type {PublicFairHand} from '@/lib/poker/live-table';
export function HandVerification({handId}:{handId:string}){
 const [hand,setHand]=useState<PublicFairHand|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch(`/api/verify/${encodeURIComponent(handId)}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const data=await response.json();if(!response.ok)throw new Error(data.error??'Could not load this hand.');
   if(!controller.signal.aborted)setHand(data.hand);
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load this hand.');});
  return()=>controller.abort();
 },[handId]);
 const valid=hand&&hand.handId===handId&&hand.scope==='disclosed-card-membership-v1'&&hand.cards.every(card=>card.handId===handId&&verifyCardProof(hand.root,card));
 return <Shell><main className="elo-page mx-auto max-w-3xl px-4 py-8">
  <Link href="/" className="elo-link">Back to lobby</Link>
  <h1 className="mt-6 text-3xl font-semibold">Hand verification</h1>
  <p className="mt-3 text-sm text-ink-soft">Checks disclosed cards against the hand’s committed deck positions. Folded cards, unused positions and shuffle seeds remain private.</p>
  {error?<p role="alert" className="mt-6">{error}</p>:!hand?<p role="status" className="mt-6">Loading hand record…</p>:<section className="elo-panel mt-6 space-y-4 p-5">
   <p role="status">{!valid?'Verification failed.':!hand.cards.length?'Commitment recorded; no cards were publicly disclosed.':`${hand.cards.length} disclosed cards match the commitment.`}</p>
   <p className="text-sm text-ink-soft">{hand.aborted?'Hand aborted. Commitment retained.':hand.complete?'Hand record complete.':'Hand in progress. More public cards may appear after settlement; reload to check again.'}</p>
   <p className="break-all text-xs">Hand: {hand.handId}</p><p className="break-all text-xs">Root: {hand.root}</p>
   <a className="elo-link text-sm" href={`/api/verify/${handId}`} download={`hand-${handId}.json`}>Download disclosed proofs</a>
   <ul className="space-y-2 text-sm">{hand.cards.map(card=><li key={card.index}>{card.card.id} · deck position {card.index+1} · {verifyCardProof(hand.root,card)?'matches':'failed'}</li>)}</ul>
  </section>}
  <p className="mt-6 text-sm text-ink-soft">Membership proofs do not establish that the shuffle was unbiased or that the server used every participant’s seed correctly. Complete deck replay is an internal audit, because publishing its inputs would reveal hidden cards.</p>
 </main></Shell>;
}
