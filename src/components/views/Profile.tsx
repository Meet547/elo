"use client";

// ---------------------------------------------------------------------------
// Profile — the ledger made public. The rating line, the record, how the
// finishes stack up, and every session with the story of how it ended:
// what you won with, or who took your last chips and in which hand.
// ---------------------------------------------------------------------------

import { AccountAccess } from "./AccountAccess";
import { useFelt, type SessionRow } from "@/store/game";
import { RatingGraph, type GraphPoint } from "@/components/felt/chart";
import { RollingNumber, Stamp, TactileButton } from "@/components/felt/kit";
import { nextTierOf, ordinal, tierOf } from "@/lib/rating";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US")}`;

function sessionLine(s: SessionRow): string {
  if (s.place === 0 && s.mode === "RANKED") return "Ranked draw · 10 hands";
  if (s.exit) return s.exit;
  if (s.place === 1) return "took the whole table down";
  if (s.bestHand) return `best hand — ${s.bestHand}`;
  if (s.net > 0) return `walked up ${usd(s.net)} · ${s.potsWon} pot${s.potsWon === 1 ? "" : "s"} won`;
  if (s.net < 0) return `left ${usd(s.net)} behind · biggest pot ${usd(s.biggestPot)}`;
  return "walked out even · table closed";
}

function Tile({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: "money" | "carmine" }) {
  return (
    <div className="rounded-xl border border-hairline bg-paper px-3.5 py-2.5">
      <div
        className={cn(
          "tnum truncate font-mono text-[14px] font-semibold leading-tight",
          tone === "money" && "text-money",
          tone === "carmine" && "text-carmine",
        )}
      >
        {v}
      </div>
      <div className="mt-1 font-mono text-[8.5px] uppercase text-ink-faint">{k}</div>
      {note && <p className="mt-1 text-[10px] text-ink-soft">{note}</p>}
    </div>
  );
}

export function ProfileView() {
  const { profile, sessions, profileStatistics, sessionsLoading, ladder, seatTable, fetchSessions } = useFelt();
  const [filter, setFilter] = useState<"all" | "cashes" | "losses">("all");

  const meRank = profile?.rank ?? ladder.find((p) => p.isMe)?.rank;

  const chrono = useMemo(() => sessions.filter(session => !session.mode || session.mode === "RANKED" || session.mode === "LEGACY").reverse(), [sessions]);
  const points: GraphPoint[] = useMemo(() => {
    if (chrono.length === 0) return [];
    return [
      { value: chrono[0].ratingBefore, at: chrono[0].createdAt, label: "first seat" },
      ...chrono.map((s, i) => ({ value: s.ratingAfter, at: s.createdAt, label: `session ${i + 1}` })),
    ];
  }, [chrono]);

  const stats = profileStatistics;
  const finishCounts = stats?.finishes ?? [];
  const mostCommonFinish = Math.max(1, ...finishCounts.map(finish => finish.count));
  const firstRate = stats?.sessions ? Math.round(stats.firsts / stats.sessions * 100) : 0;

  if (!profile) return null;

  const tier = tierOf(profile.rating);
  const next = nextTierOf(profile.rating);
  const streak =
    profile.streak === 0 ? "no streak" : profile.streak > 0 ? `W${profile.streak} streak` : `L${-profile.streak} slide`;

  const filtered = sessions.filter((s) =>
    filter === "all" ? true : filter === "cashes" ? s.net >= 0 : s.net < 0,
  );

  return (
    <div className="elo-page max-w-5xl flex-1">
      {/* ---------------------------------------------------------- header */}
      <div className="elo-panel flex flex-wrap items-end justify-between gap-4 p-5 sm:p-7">
        <div>
          <div className="label">player profile</div>
          <div className="mt-2 flex items-center gap-3.5">
            <h1 className="break-all text-4xl font-normal leading-none sm:text-5xl">{profile.name}</h1>
            <Stamp rot={-3} tone={tier.label === "Carmine" ? "carmine" : "ink"} className="scale-[0.82]">
              {tier.label}
            </Stamp>
          </div>
          <div className="mt-2.5 font-mono text-[10px] uppercase text-ink-faint">
            {meRank ? `${ordinal(meRank)} on the ladder · ` : ""}
            peak {profile.peak.toLocaleString("en-US")}
            {next ? ` · ${Math.max(0, next.at - profile.rating)} to ${next.label}` : " · the ceiling"}
          </div>
        </div>
        <div className="text-right">
          <div className="label">rating</div>
          <RollingNumber
            value={profile.rating}
            className="mt-1 font-mono text-[30px] font-semibold leading-none "
          />
          <div
            className={cn(
              "mt-1.5 font-mono text-[10px] uppercase ",
              profile.streak > 0 ? "text-money" : profile.streak < 0 ? "text-carmine" : "text-ink-faint",
            )}
          >
            {streak}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- graph + record */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_292px]">
        <RatingGraph points={points} currentRating={profile.rating} loading={sessionsLoading} onRefresh={fetchSessions}
          emptyAction={<TactileButton variant="paper" size="sm" onClick={seatTable}>Take a seat — $1,500</TactileButton>} />

        <aside className="flex flex-col gap-5">
          <section className="grid grid-cols-2 gap-2">
            <Tile k="recorded hands" v={stats?.hands.toLocaleString("en-US") ?? "—"} />
            <Tile k="firsts" v={stats?.firsts.toLocaleString("en-US") ?? "—"} />
            <Tile k="first-place rate" v={stats?.sessions ? `${firstRate}%` : "—"} note={stats?.sessions ? `${stats.firsts} of ${stats.sessions} sessions` : undefined} />
            <Tile k="pots won" v={stats?.potsWon.toLocaleString("en-US") ?? "—"} />
            <Tile k="biggest pot" v={stats?.biggestPot ? usd(stats.biggestPot) : "—"} />
            <Tile
              k="best session"
              v={stats?.bestNet != null && stats.bestNet > 0 ? `+${usd(stats.bestNet!)}` : "—"}
              tone={stats?.bestNet != null && stats.bestNet > 0 ? "money" : undefined}
            />
            <Tile
              k="worst session"
              v={stats?.worstNet != null && stats.worstNet < 0 ? `−${usd(stats.worstNet!)}` : "—"}
              tone={stats?.worstNet != null && stats.worstNet < 0 ? "carmine" : undefined}
            />
            <Tile
              k="recorded lifetime net"
              v={stats ? `${stats.net >= 0 ? "+" : "−"}${usd(stats.net)}` : "—"}
              tone={(stats?.net ?? 0) > 0 ? "money" : (stats?.net ?? 0) < 0 ? "carmine" : undefined}
            />
          </section>

          <section className="elo-panel p-5">
            <h3 className="font-display text-[16px] leading-none">Lifetime recorded finishes</h3>
            <div className="mt-4 space-y-2.5">
              {finishCounts.map(({ place, count }) => {
                return (
                  <div key={place} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "w-8 font-mono text-[10px]",
                        place === 1 ? "font-semibold text-money" : "text-ink-faint",
                      )}
                    >
                      {place === 0 ? "Draw" : ordinal(place)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-700",
                          place === 1 ? "bg-money" : place <= 3 ? "bg-ink/75" : "bg-hairline-dark",
                        )}
                        style={{ width: `${(count / mostCommonFinish) * 100}%` }}
                      />
                    </div>
                    <span className="tnum w-5 text-right font-mono text-[10px] text-ink-soft">{count}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      {/* ----------------------------------------------------- the ledger */}
      <section className="elo-panel mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline px-4 py-2.5 sm:px-5">
          <h3 className="font-display text-2xl leading-none">Latest 60 recorded sessions</h3>
          <div className="flex items-center gap-1">
            {(
              [
                ["all", "all"],
                ["cashes", "in the money"],
                ["losses", "losses"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "min-h-11 rounded-md px-2 font-mono text-[9px] uppercase transition-colors sm:min-h-8",
                  filter === key ? "bg-ink text-paper" : "text-ink-faint hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center font-mono text-[11px] text-ink-faint">
            {sessions.length === 0
              ? "Nothing here yet — the ledger starts when you take a seat."
              : "Nothing under this filter."}
          </div>
        ) : (
          filtered.map((s, i) => {
            const delta = s.ratingAfter - s.ratingBefore;
            const day = new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            return (
              <div key={s.id} className={cn("px-5 py-3", i > 0 && "border-t border-hairline")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span
                      className={cn(
                        "w-8 shrink-0 font-mono text-[11px]",
                        s.place === 1 ? "font-semibold text-money" : s.place === s.seats ? "font-semibold text-carmine" : "text-ink",
                      )}
                    >
                      {s.place === 0 ? "Draw" : ordinal(s.place)}
                    </span>
                    <span className="font-mono text-[10px] text-ink-faint">{day}</span>
                    <span className="hidden font-mono text-[10px] text-ink-faint md:block">{s.hands} hands</span>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-4">
                    <span className="hidden text-right font-mono text-[10px] text-ink-faint sm:block">
                      {s.ratingBefore.toLocaleString("en-US")} → {s.ratingAfter.toLocaleString("en-US")}
                    </span>
                    <span
                      className={cn(
                        "tnum w-10 text-right font-mono text-[11px] font-semibold",
                        delta > 0 ? "text-money" : delta < 0 ? "text-carmine" : "text-ink-faint",
                      )}
                    >
                      {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                      {Math.abs(delta)}
                    </span>
                    <span
                      className={cn(
                        "tnum w-16 text-right font-mono text-[12px] font-semibold",
                        s.net > 0 ? "text-money" : s.net < 0 ? "text-carmine" : "text-ink-soft",
                      )}
                    >
                      {s.net > 0 ? "+" : s.net < 0 ? "−" : ""}
                      {usd(s.net)}
                    </span>
                  </div>
                </div>
                <div className="mt-1 truncate pl-11 font-mono text-[10px] text-ink-faint">
                  {sessionLine(s)}
                  {s.bestSeenHand && <p>Best seen · {s.bestSeenHand}</p>}
                  {s.bestWinningHand && <p>Best winning · {s.bestWinningHand}</p>}
                </div>
              </div>
            );
          })
        )}
      </section>

      <AccountAccess />

      <p className="mt-4 text-center font-mono text-[9px] uppercase text-ink-faint">
        each ranked match updates both players from their pre-match ratings
      </p>
    </div>
  );
}
