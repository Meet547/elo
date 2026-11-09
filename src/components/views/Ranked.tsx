"use client";

import { postGameCommand } from "@/lib/game-command";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { Shell } from "./Shell";
import { TactileButton } from "@/components/felt/kit";
import { PROVISIONAL_SESSIONS } from "@/lib/rating";
import { RANKED_HANDS, type RankedQueueStatus } from "@/lib/poker/ranked-match";
import { useFelt } from "@/store/game";
import { Reconnect } from "./Reconnect";
import { Onboard } from "./Onboard";

async function queueRequest(command: "join" | "poll" | "cancel", signal?: AbortSignal): Promise<RankedQueueStatus> {
  if (signal?.aborted) throw new DOMException('Aborted','AbortError');
  const response = await postGameCommand("/api/ranked", { command }, { signal, owner:useFelt.getState().profile?.id });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not reach the ranked queue.");
  return data;
}

export function RankedEntry({ autoQueue }: { autoQueue: boolean }) {
  const profile = useFelt((state) => state.profile);
  const bootError = useFelt((state) => state.bootError);
  const booting = useFelt((state) => state.booting);
  const boot = useFelt((state) => state.boot);
  useEffect(() => { if (!profile) void boot(); }, [boot, profile]);
  if (!profile && booting) return <main className="elo-page" role="status">Opening ranked play…</main>;
  if (!profile && bootError) return <Reconnect />;
  if (!profile) return <Onboard />;
  return <Shell><p className="mb-3 text-sm text-ink-soft">Verified accounts only · 10/20 blinds · {(profile.rankedPlacements ?? 0) < PROVISIONAL_SESSIONS ? `Placement pool: ${profile.rankedPlacements ?? 0}/${PROVISIONAL_SESSIONS} matches completed` : "Established pool"}</p><RankedQueue autoQueue={autoQueue} rating={profile.rating} /></Shell>;
}

function RankedQueue({ autoQueue, rating }: { autoQueue: boolean; rating: number }) {
  const router = useRouter();
  const [queue, setQueue] = useState<RankedQueueStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const accept = useCallback((next: RankedQueueStatus) => {
    setQueue(next);
    setError("");
    if (next.status === "matched") router.replace(`/live/${next.code}`);
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    void queueRequest(autoQueue ? "join" : "poll", controller.signal)
      .then((next) => {
        accept(next);
        if (autoQueue && next.status !== "matched") router.replace("/ranked", { scroll: false });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not open the queue."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [accept, autoQueue, router]);

  useEffect(() => {
    if (busy || queue?.status !== "searching") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let stream: EventSource | undefined;
    let delay = 750;
    const connect = () => {
      if (stopped) return;
      const source = new EventSource("/api/ranked/events");
      stream = source;
      source.onmessage = (event) => {
        if (stopped || stream !== source) return;
        delay = 750;
        const next = JSON.parse(event.data) as RankedQueueStatus;
        accept(next);
        if (next.status !== "searching") source.close();
      };
      source.addEventListener("unavailable", (event) => {
        source.close();
        setQueue(null);
        setError(JSON.parse((event as MessageEvent).data));
      });
      source.onerror = () => {
        source.close();
        if (stopped || stream !== source) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => { stopped = true; stream?.close(); clearTimeout(timer); };
  }, [accept, busy, queue?.status]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  async function change(command: "join" | "cancel") {
    if (busy) return;
    setBusy(true);
    try {
      accept(await queueRequest(command));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your place in the queue.");
    } finally {
      setBusy(false);
    }
  }

  const searching = queue?.status === "searching";
  const elapsed = searching ? Math.max(0, Math.floor((now - queue.joinedAt) / 1_000)) : 0;
  const currentRating = queue?.rating ?? rating;
  const matched = queue?.status === "matched";

  return (
    <div className="elo-page max-w-5xl flex-1">
        <section className="elo-hero grain p-6 sm:p-10">
          <p className="font-mono text-xs uppercase text-[#dfd6ac]">Ranked Hold’em · Heads-up</p>
          <h1 className="mt-2 font-display text-4xl leading-none sm:text-5xl lg:text-6xl">Find your next rival.</h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#e3e7d9] sm:text-base">
            One opponent near your rating. Ten hands, fresh $1,500 stacks each hand.
            The player with the most total chip profit wins. Confirm within 15 seconds before the deal.
            Three missed decisions or 60 seconds offline forfeits the match; both players absent voids it.
          </p>
        </section>
        <section className="elo-panel mt-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-5">
            <div>
              <p className="label">Your current rating</p>
              <p className="tnum mt-1 font-mono text-3xl font-semibold">{currentRating.toLocaleString("en-US")}</p>
            </div>
            <span className="flex items-center gap-2 rounded-full border border-hairline px-3 py-2 text-sm text-ink-soft"><Trophy size={16} aria-hidden /> {RANKED_HANDS}-hand match</span>
          </div>
          <div className="py-6">
            <h2 className="flex items-center gap-2.5 font-display text-3xl" role="status">
              {searching && <span className="live-dot size-2 rounded-full bg-money" aria-hidden />}
              {matched ? "Opponent found" : searching ? "Finding your opponent…" : "Ready for a ranked match?"}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
              {matched ? "Taking you to the table."
                : searching ? "Keep this screen open for the ready check. Searches end after three minutes."
                  : queue?.status === "expired" ? "This search reached its time limit. You can start a new search."
                    : "Elo matches real players by rating. After the result is saved, your next search uses your updated rating."}
            </p>
            {searching && (
              <div className="tnum mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-soft">
                <span className="font-mono">Waiting {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
                <span>Rating range {Math.max(400, currentRating - queue.range)}–{Math.min(4000, currentRating + queue.range)}</span>
              </div>
            )}
          </div>
          {error && <p role="alert" className="mb-3 text-sm text-carmine-deep">{error}</p>}
          {searching ? (
            <TactileButton variant="paper" className="h-12 w-full sm:w-auto" disabled={busy} onClick={() => void change("cancel")}>Cancel search</TactileButton>
          ) : (
            <TactileButton variant="accent" size="lg" className="w-full sm:w-auto" disabled={busy || matched}
              onClick={() => void change("join")}>{busy ? "Checking your seat…" : matched ? "Opening table…" : "Find ranked match"}<ArrowRight size={16} aria-hidden /></TactileButton>
          )}
        </section>
        <div className="mt-4 grid gap-3 text-sm text-ink-soft sm:grid-cols-3">
          <p className="elo-panel p-4"><strong className="mb-1 block text-ink">Nearby ratings first</strong>The search widens gradually when the queue is quiet.</p>
          <p className="elo-panel p-4"><strong className="mb-1 block text-ink">Ten hands, equal stacks</strong>Dealer positions alternate. Total profit decides the match.</p>
          <p className="elo-panel p-4"><strong className="mb-1 block text-ink">One saved result</strong>Your rating updates after hand ten, then you can find your next opponent.</p>
        </div>
    </div>
  );
}
