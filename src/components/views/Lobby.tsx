"use client";

// ---------------------------------------------------------------------------
// Lobby — the ladder, tonight's table ticket, and the wire.
// ---------------------------------------------------------------------------

import { useFelt } from "@/store/game";
import { FadeList, LiveDot, Stamp, TactileButton } from "@/components/felt/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { tableTemperament } from "@/lib/matchmaking";
import { sessionOutlook } from "@/lib/rating";
import { cn } from "@/lib/utils";
import { SPRING } from "@/lib/motion";
import { motion } from "framer-motion";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Ord(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function Lobby() {
  const { profile, ladder, wire, ladderLoading, refreshLadder, seatTable, offer } = useFelt();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const players = query ? ladder.filter((player) => player.name.toLowerCase().includes(query)) : ladder;
  // the ticket and the table are the same object — no re-roll at seat time
  const opponents = offer?.opponents ?? [];
  const tableNo = offer?.tableNo ?? 1;

  const outlook =
    offer && profile
      ? sessionOutlook(
          { rating: profile.rating, rd: profile.rd },
          opponents.map((o) => ({ rating: o.rating, rd: o.rd ?? 70 })),
        )
      : null;
  const temperament = opponents.length ? tableTemperament(opponents) : "—";

  return (
    <div className="elo-page flex flex-1 flex-col">
      <header className="elo-hero grain mb-6 flex flex-wrap items-end justify-between gap-5 p-5 sm:mb-8 sm:p-8">
        <div>
          <p className="font-mono text-[10px] uppercase text-[#e0d6af]">The poker room</p>
          <h1 className="mt-2 font-display text-5xl leading-none sm:text-6xl">Your seat is open.</h1>
          <p className="mt-2 text-sm text-[#e4e7dc]">Climb the ranked ladder, play friends, or warm up against the house.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/ranked?queue=1" className="tactile inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#e3d7ab] bg-[#f6eccd] px-3 text-sm font-semibold text-ink hover:bg-[#fff5db] sm:px-4">
            Play ranked <ArrowUpRight size={17} aria-hidden />
          </Link>
          <Link href="/live" className="inline-flex min-h-11 items-center rounded-xl border border-[#eee5c4]/45 px-3 text-sm text-[#fdf8e8] hover:bg-white/10">
            Play with friends
          </Link>
          <TactileButton variant="ghost" size="sm" className="h-11 border-[#eee5c4]/45 px-3 text-[#fdf8e8] hover:bg-white/10 md:hidden" onClick={seatTable}>
            Practice
          </TactileButton>
        </div>
      </header>
      {/* ------------------------------------------------------------ body */}
      <div className="grid flex-1 grid-cols-1 content-start items-start gap-5 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
        {/* ladder */}
        <section className="min-w-0 lg:row-span-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2.5 font-display text-3xl leading-none">
              The ladder
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-ink-faint">
                <LiveDot /> live
              </span>
            </h2>
            <span className="label hidden sm:block">glicko-2 · ranked heads-up</span>
          </div>

          <div className="elo-panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-hairline p-3">
              <Search size={16} className="shrink-0 text-ink-faint" aria-hidden />
              <input type="search" aria-label="Find a player" placeholder="Find a player"
                className="elo-input w-full py-1.5 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} />
              <TactileButton variant="ghost" size="sm" onClick={() => void refreshLadder()} disabled={ladderLoading}>Refresh</TactileButton>
            </div>
            <div className="grid grid-cols-[26px_1fr_72px_46px] items-center gap-2 border-b border-hairline bg-canvas/60 px-3.5 py-2.5 sm:grid-cols-[44px_1fr_92px_76px_64px] sm:px-4">
              <span className="label">#</span>
              <span className="label">player</span>
              <span className="label text-right">rating</span>
              <span className="label hidden text-right sm:block">hands</span>
              <span className="label text-right">cashes</span>
            </div>
            <div className="quiet-scroll max-h-[560px] overflow-y-auto">
              {ladderLoading && ladder.length === 0 ? (
                <div className="px-4 py-10 text-center font-mono text-[11px] text-ink-faint">Dealing the ladder…</div>
              ) : players.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-soft">{query ? "No players match that name." : "The ladder is unavailable. Try refreshing."}</p>
              ) : (
                players.map((p) => (
                  <motion.div
                    layout
                    key={p.id}
                    transition={SPRING.ladder}
                    className={cn(
                      "relative grid grid-cols-[26px_1fr_72px_46px] items-center gap-2 px-3.5 py-2.5 sm:grid-cols-[44px_1fr_92px_76px_64px] sm:px-4",
                      p.isMe ? "bg-[#fbf6ee]" : "bg-paper",
                      "border-b border-hairline last:border-b-0",
                    )}
                  >
                    {p.isMe ? <span className="absolute left-0 top-0 h-full w-[3px] bg-carmine" /> : null}
                    <span className={cn("tnum font-mono text-[11px]", p.rank <= 3 ? "font-semibold text-ink" : "text-ink-faint")}>
                      {p.rank}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px]">{p.name}</span>
                      {p.isMe ? <Stamp rot={-3} tone="carmine" className="scale-[0.62] px-1.5 py-0 ">you</Stamp> : null}
                      {p.streak >= 3 ? <span className="font-mono text-[9px] font-semibold text-money">W{p.streak}</span> : null}
                      {p.streak <= -3 ? <span className="font-mono text-[9px] font-semibold text-carmine">L{-p.streak}</span> : null}
                    </span>
                    <span className="tnum text-right font-mono text-[13px]">{p.rating.toLocaleString("en-US")}</span>
                    <span className="tnum hidden text-right font-mono text-[11px] text-ink-faint sm:block">
                      {p.hands.toLocaleString("en-US")}
                    </span>
                    <span className="tnum text-right font-mono text-[11px] text-ink-soft">{p.cashes}</span>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* right rail */}
        <aside className="contents">
          <section className="elo-panel relative order-first overflow-hidden lg:order-none lg:col-start-2 lg:row-start-1">
            <div className="border-b border-dashed border-ink/25 px-5 pt-5 pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-3xl leading-none">Ranked Match</h3>
                <span className="label text-money-deep">Real players</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">A nearby rating. Ten hands. One result.</p>
            </div>
            <div className="px-5 py-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-ink-soft">Your rating</dt><dd className="tnum font-mono font-semibold">{profile?.rating.toLocaleString("en-US") ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ink-soft">Format</dt><dd>Heads-up · 10 hands</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ink-soft">Starting chips</dt><dd className="tnum">$1,500 each hand</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-ink-soft">Winner</dt><dd>Total chip profit</dd></div>
              </dl>
              <Link href="/ranked?queue=1" className="tactile mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-money-deep bg-money px-3 font-mono text-xs uppercase r text-paper hover:bg-money-deep">
                Find ranked match <ArrowUpRight size={15} aria-hidden />
              </Link>
              <p className="mt-2 text-center text-[11px] text-ink-soft">Your next match uses your new rating.</p>
            </div>
          </section>
          {/* tonight's table */}
          <section className="elo-panel relative order-first overflow-hidden lg:order-none lg:col-start-2 lg:row-start-2">
            <div className="border-b border-dashed border-ink/25 px-5 pt-5 pb-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-3xl leading-none">Practice table</h3>
                <div className="flex items-center gap-2">
                  {offer ? (
                    <Stamp rot={2} tone={offer.humans > 0 ? "money" : "ink"} className="scale-[0.72] px-1.5 py-0 ">
                      {offer.humans > 0 ? `${offer.humans} human${offer.humans === 1 ? "" : "s"}` : "house field"}
                    </Stamp>
                  ) : null}
                  <span className="label">No. {tableNo}</span>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[10px] uppercase text-ink-faint">
                six max · no-limit hold&apos;em · blinds rise every 8 hands
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="space-y-1">
                {opponents.length === 0 ? (
                  <div className="py-2 font-mono text-[10px] text-ink-faint">Dealing a table…</div>
                ) : null}
                {opponents.map((o, i) => {
                  const edge = profile ? o.rating - profile.rating : 0;
                  return (
                    <div key={`${o.slug}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-3 shrink-0 font-mono text-[9px] text-ink-faint">{i + 2}</span>
                        <span className="truncate text-[13px] text-ink-soft">{o.name}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span className="tnum font-mono text-[11px] text-ink-faint">
                          {o.rating.toLocaleString("en-US")}
                        </span>
                        <span
                          className={cn(
                            "tnum w-[30px] text-right font-mono text-[9px]",
                            edge > 0 ? "text-carmine" : "text-money",
                          )}
                          title="rating vs yours"
                        >
                          {edge > 0 ? `+${edge}` : edge}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="my-3 flex items-center justify-between border-t border-dashed border-ink/25 pt-2.5">
                <span className="font-mono text-[9px] uppercase text-ink-faint">
                  field {offer ? offer.fieldAvg.toLocaleString("en-US") : "—"}
                </span>
                <span className="font-mono text-[9px] uppercase text-ink-faint">
                  spread {offer ? `±${offer.spread}` : "—"}
                </span>
                <span className="font-mono text-[9px] uppercase text-ink-faint">{temperament}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase text-ink-faint">Buy-in, every game</span>
                <span className="tnum font-mono text-[15px] font-semibold">$1,500</span>
              </div>
              <TactileButton variant="accent" size="lg" className="mt-4 w-full" onClick={seatTable}>
                Take a seat
              </TactileButton>
              <p className="mt-2 text-center font-mono text-[9px] uppercase text-ink-faint">
                {outlook
                  ? `${Math.round(outlook.winProb * 100)}% to take it · expected ${outlook.expectedPlace.toFixed(1)}${outlook.expectedPlace === 1 ? "st" : "th"}`
                  : "balance refreshes every game"}
              </p>
              <p className="mt-1 text-center font-mono text-[8.5px] uppercase text-ink-faint/70">
                House bots · cash out after ten hands
              </p>
            </div>
          </section>

          {/* the wire */}
          <section className="order-2 lg:order-none lg:col-start-2 lg:row-start-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-3xl leading-none">
                The wire <LiveDot />
              </h3>
              <span className="label">settled</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-hairline bg-paper">
              <FadeList className="max-h-[264px]">
                {wire.length === 0 ? (
                  <div className="px-4 py-6 text-center font-mono text-[11px] text-ink-faint">Quiet for now.</div>
                ) : (
                  wire.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate text-[12px]">
                          {w.name} <span className="text-ink-faint">{w.place === 0 ? "drew" : `took ${Ord(w.place)}`}</span>
                        </div>
                        <div className="font-mono text-[9px] uppercase text-ink-faint">
                          {w.hands} hands · {timeAgo(w.at)} ago
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("tnum font-mono text-[12px] font-semibold", w.net >= 0 ? "text-money" : "text-carmine")}>
                          {w.net >= 0 ? "+" : "−"}${Math.abs(w.net).toLocaleString("en-US")}
                        </div>
                        <div className="tnum font-mono text-[10px] text-ink-faint">
                          {w.ratingBefore.toLocaleString("en-US")} → {w.ratingAfter.toLocaleString("en-US")}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </FadeList>
            </div>
          </section>

          {/* how rating works */}
          <Dialog>
            <DialogTrigger asChild>
              <button className="group order-3 flex items-center justify-between rounded-xl border border-hairline bg-paper px-4 py-3 text-left transition-colors hover:bg-[#faf8f2] lg:order-none lg:col-start-2 lg:row-start-4">
                <span className="text-[13px] font-medium">How the rating works</span>
                <span className="font-mono text-[10px] uppercase text-ink-faint group-hover:text-ink">read</span>
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl border-hairline bg-paper sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">How the rating works</DialogTitle>
              </DialogHeader>
              <div className="space-y-3.5 text-[13.5px] leading-relaxed text-ink-soft">
                <p>
                  Every ranked match is ten heads-up hands against one real opponent. Both players
                  start each hand with $1,500. Total chip profit decides the winner, and equal
                  totals count as a draw. Both ratings update from the same pre-match snapshot.
                </p>
                <p>
                  Every rating carries a deviation — how sure the ladder is. A new seat starts at
                  ±110; a regular settles near ±55. The wider the band, the more one session can
                  move you. Beating a proven 1,900 side is worth more than beating a provisional
                  1,200, because their deviation says which one it is.
                </p>
                <div className="rounded-xl border border-hairline bg-canvas/70 px-4 py-3 font-mono text-[11px] leading-relaxed">
                  <div className="text-ink-faint">glicko-2 · one update per match</div>
                  <div>Win against a stronger opponent → more points</div>
                  <div>Draw → expected strength determines the adjustment</div>
                  <div>Practice and private games → no rating change</div>
                </div>
                <p>
                  Matchmaking starts within 75 rating points and gradually widens to 350 points
                  as both players wait. It chooses the closest available rating inside both
                  players&apos; ranges. The next search uses your updated rating.
                </p>
                <p className="text-[12px] text-ink-faint">
                  Chips decide place only. The ladder remembers, game after game.
                </p>
              </div>
            </DialogContent>
          </Dialog>

          {/* your record */}
          {profile && profile.hands > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { k: "hands", v: profile.hands.toLocaleString("en-US") },
                { k: "peak", v: profile.peak.toLocaleString("en-US") },
                { k: "biggest pot", v: `$${profile.biggestPot.toLocaleString("en-US")}` },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-hairline bg-paper px-3 py-2.5 text-center">
                  <div className="tnum font-mono text-[13px] font-semibold">{s.v}</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase text-ink-faint">{s.k}</div>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>

    </div>
  );
}
