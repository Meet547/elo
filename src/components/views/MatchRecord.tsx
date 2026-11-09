"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cardLabel, type Card } from "@/lib/poker/cards";
import { Shell } from "./Shell";

type RecordView = {
  title: string;
  state?: string;
  results: { player: { name: string }; place: number; hands: number; net: number; ratingBefore: number; ratingAfter: number }[];
  hands: { id: string; number: number; pot: number; actions: string[]; cards: Card[] }[];
};

export function MatchRecord({ id }: { id: string }) {
  const [record, setRecord] = useState<RecordView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/match/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Could not load match record.");
      setRecord(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id]);
  return <Shell><div className="elo-page max-w-4xl">
    <Link className="elo-link" href="/profile">Profile and recorded results</Link>
    <h1 className="my-4 text-3xl">{record?.title ?? "Match record"}</h1>
    {error ? <p role="alert">{error} <Link className="elo-link" href="/login">Sign in</Link></p> : !record ? <p role="status">Loading match record…</p> : <>
      {record.state && <p className="mb-3 text-sm text-ink-soft">{record.state}</p>}
      {record.results.length > 0 && <ul className="elo-panel mb-4 space-y-2 p-5">
        {record.results.map((result, index) => <li key={index} className="break-words text-sm">
          {result.player.name} · {result.place === 0 ? "Draw" : `Place ${result.place}`} · {result.hands} hands · {result.net.toLocaleString("en-US")} chips · {result.ratingBefore} to {result.ratingAfter}
        </li>)}
      </ul>}
      <h2 className="my-3 text-xl">Latest 30 recorded hands</h2>
      {!record.hands.length && <p className="text-sm text-ink-soft">No completed hand details are available for this record.</p>}
      {record.hands.map(hand => <details key={hand.id} className="elo-panel mb-3 space-y-3 p-4">
        <summary className="cursor-pointer">Hand {hand.number} · {hand.pot.toLocaleString("en-US")} chips awarded</summary>
        <p className="break-words text-sm">Disclosed cards: {hand.cards.map(cardLabel).join(" ") || "none"}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{hand.actions.map((action, index) => <li key={index}>{action}</li>)}</ol>
        <Link className="elo-link inline-block" href={`/verify/${hand.id}`}>Verify disclosed cards</Link>
      </details>)}
    </>}
  </div></Shell>;
}
