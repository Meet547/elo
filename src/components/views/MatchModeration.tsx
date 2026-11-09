"use client";

import { useState } from "react";
import { TactileButton } from "@/components/felt/kit";
import { postGameCommand } from "@/lib/game-command";
import { useFelt } from "@/store/game";

interface MatchReview {
  id: string;
  state: string;
  flags: string[];
  participants: { playerId: string; player: { name: string } }[];
  pair: { matches: number; draws: number; wins: Record<string, number> } | null;
  moderation: { action: string } | null;
}

export function MatchModeration() {
  const [matches, setMatches] = useState<MatchReview[]>([]);
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/matches", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load match review.");
      const data = await response.json();
      setMatches(data.matches);
      setMessage(`Loaded ${data.matches.length} recent matches.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Match review unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      const response = await postGameCommand("/api/admin/matches", { matchId: id, reason },
        { owner: useFelt.getState().profile?.id });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update the match.");
      setMessage(data.moderation.action === "VOID" ? "Match voided." : "Rating changes reversed.");
      setMatches(current => current.map(match => match.id === id ? { ...match, moderation: data.moderation } : match));
      setId("");
      setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Match update unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return <details className="border-t border-hairline pt-3">
    <summary className="cursor-pointer">Ranked moderation</summary>
    <p className="my-2 text-sm text-ink-soft">Review signals from the latest 500 matches within seven days. Signals are for review.</p>
    <TactileButton disabled={busy} onClick={() => void load()}>Load recent matches</TactileButton>
    <ul className="my-3 max-h-72 space-y-2 overflow-auto text-sm">
      {matches.map(match => <li key={match.id} className="border-b border-hairline pb-2">
        <button type="button" className="min-h-11 text-left underline" onClick={() => setId(match.id)}>
          {match.participants.map(seat => seat.player.name).join(" vs ")} · {match.moderation?.action ?? match.state}
        </button>
        {match.flags.length > 0 && <p>{match.flags.join(" · ")}</p>}
        {match.pair && <p>{match.pair.matches} recorded pair matches · {match.pair.draws} draws. {match.participants.map(seat => `${seat.player.name} won ${match.pair!.wins[seat.playerId] ?? 0}/${match.pair!.matches}`).join(" · ")}</p>}
      </li>)}
    </ul>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="block" htmlFor="moderation-match">Match ID</label>
      <input className="elo-input w-full" id="moderation-match" value={id} maxLength={80} onChange={event => setId(event.target.value)} required />
      <label className="block" htmlFor="moderation-reason">Audit reason</label>
      <textarea className="elo-input w-full" id="moderation-reason" value={reason} minLength={8} maxLength={500} onChange={event => setReason(event.target.value)} required />
      <TactileButton type="submit" disabled={busy || !id || reason.trim().length < 8}>Void or reverse match</TactileButton>
    </form>
    {message && <p className="mt-2 text-sm" role="status">{message}</p>}
  </details>;
}
