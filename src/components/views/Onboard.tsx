"use client";

import { useFelt } from "@/store/game";
import { TactileButton } from "@/components/felt/kit";
import { Wordmark } from "@/components/felt/brand";
import { RoomFooter } from "@/components/felt/room-footer";
import { CARD_BACK_SRC } from "@/components/felt/poker-assets";
import { useState } from "react";

export function Onboard({ invite = false }: { invite?: boolean }) {
  const { createProfile, ladder } = useFelt();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await createProfile(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not claim a seat. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <main className="elo-page flex min-h-dvh max-w-6xl flex-col justify-center">
        <header className="mb-5 flex items-center justify-between gap-3 sm:mb-8">
          <Wordmark className="text-3xl sm:text-4xl" />
          <span className="label">Play money · No-limit Hold’em</span>
        </header>
        <section className="elo-hero grain grid gap-8 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_17rem] md:items-center lg:p-12">
          <div className="relative z-10">
            <p className="font-mono text-[11px] uppercase text-[#e3d7a8]">{invite ? "You’re invited" : "The ranked poker room"}</p>
            <h1 className="mt-3 max-w-2xl font-display text-6xl leading-[0.88] sm:text-7xl lg:text-[5.5rem]">{invite ? "Take your seat." : "Good hands. Better reads."}</h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-[#e3e7d9] sm:text-base">
            {invite ? "Claim an Elo profile to join your friend’s live table." : "Find a real opponent near your rating, play a ten-hand ranked match, or warm up against the house."}
            </p>
          </div>
          <div className="relative hidden h-56 items-center justify-center md:flex" aria-hidden>
            <img src={CARD_BACK_SRC} alt="" className="absolute w-[7.2rem] -translate-x-12 -rotate-[18deg] drop-shadow-xl" />
            <img src="/poker/cards/QH.svg" alt="" className="absolute w-[7.2rem] -translate-x-2 -rotate-[4deg] drop-shadow-xl" />
            <img src="/poker/cards/AS.svg" alt="" className="absolute w-[7.2rem] translate-x-11 translate-y-3 rotate-[13deg] drop-shadow-xl" />
          </div>
        </section>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form className="elo-panel p-5 sm:p-7" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <h2 className="font-display text-3xl">Claim a seat</h2>
            <p className="mt-1 text-sm text-ink-soft">New players start at a provisional rating of 1,200.</p>
            <label className="label mt-4 block" htmlFor="name">Table name</label>
            <div className="mt-2 flex flex-wrap gap-2 max-[360px]:flex-col">
              <input id="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={18}
                placeholder="Your table name" required aria-describedby={error ? "profile-error" : undefined} className="elo-input flex-1" />
              <TactileButton type="submit" size="lg" variant="accent" disabled={!name.trim() || busy}>
                {busy ? "Joining…" : "Claim seat"}
              </TactileButton>
            </div>
            {error && <p id="profile-error" role="alert" className="mt-3 text-sm text-carmine-deep">{error}</p>}
          </form>
          {ladder.length > 0 && (
            <section className="elo-panel p-5 sm:p-7">
              <h2 className="font-display text-3xl">The ladder</h2>
              <ol className="mt-2 divide-y divide-hairline">
                {ladder.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate"><span className="tnum mr-3 text-ink-faint">{p.rank}</span>{p.name}</span>
                    <span className="tnum font-mono">{p.rating.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </main>
      <RoomFooter />
    </>
  );
}
