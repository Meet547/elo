"use client";

import Link from "next/link";
import {postGameCommand} from "@/lib/game-command";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Copy, List, Users } from "lucide-react";
import { Wordmark } from "@/components/felt/brand";
import { Shell } from "./Shell";
import { ROOM_CODE_LENGTH, parseRoomCode } from "@/lib/room-code";
import { OneTimeCode } from "@/components/felt/one-time-code";
import { Receipt } from "@/components/felt/receipt";
import { ChipCluster, ChipStack, DealerButton } from "@/components/felt/chips";
import { TactileButton } from "@/components/felt/kit";
import { CompactPlayer, CompactSeat, MobileBettingDock, useCompactTable } from "@/components/felt/mobile-table";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CardSlot, FanHand, PlayingCard } from "@/components/felt/playing-card";
import { ShuffleFX } from "@/components/felt/shuffle";
import { useFelt } from "@/store/game";
import { serverClockOffset, secondsToDeadline } from "@/lib/poker/server-clock";
import { HUMAN_TURN_MS } from "@/lib/poker/turn-timing";
import { verifyDeck } from "@/lib/poker/cards";
import { boardCardDelay, holeCardDelay, isRunout } from "@/lib/poker/deal-timing";
import { LIVE_CAPACITY, type LiveCommand, type LiveSnapshot } from "@/lib/poker/live-table";
import { cn } from "@/lib/utils";
import { Reconnect } from "./Reconnect";
import { Onboard } from "./Onboard";

const dollars = (amount: number) => "$" + amount.toLocaleString("en-US");
const signedChips = (amount: number) => `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${dollars(Math.abs(amount))}`;

export function LiveEntry({ code }: { code?: string }) {
  const profile = useFelt((state) => state.profile);
  const bootError = useFelt((state) => state.bootError);
  const booting = useFelt((state) => state.booting);
  const boot = useFelt((state) => state.boot);
  useEffect(() => { if (!profile) void boot(); }, [boot, profile]);
  if (!profile && booting) return <div className="elo-page" role="status">Opening the poker room…</div>;
  if (!profile && bootError) return <Reconnect />;
  if (!profile) return <Onboard invite={Boolean(code)} />;
  return code ? <LiveRoom key={code} code={code} /> : <LiveLobby />;
}

function LiveHeader({ compact = false, actions }: { compact?: boolean; actions?: ReactNode }) {
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-3", compact ? "py-1" : "mb-5 sm:mb-8")}>
      <Link href="/" aria-label="Elo lobby" className="inline-flex min-h-11 items-center"><Wordmark className={compact ? "text-2xl" : "text-3xl"} /></Link>
      <div className="flex items-center gap-2">
        {actions}
        <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft size={16} aria-hidden /> Lobby
        </Link>
      </div>
    </header>
  );
}

function LiveLobby() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinStatus, setJoinStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [joinError, setJoinError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await postGameCommand("/api/live", {}, {owner:useFelt.getState().profile?.id});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create a room.");
      router.push(`/live/${data.room.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a room.");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (joinStatus === "checking" || joinStatus === "valid") return;
    if (!parseRoomCode(code)) {
      setJoinStatus("invalid");
      setJoinError("Enter all 6 characters of your room code.");
      return;
    }
    setJoinStatus("checking");
    setJoinError("");
    try {
      const response = await fetch(`/api/live/${code}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open this room.");
      setJoinStatus("valid");
      router.push(`/live/${code}`);
    } catch (cause) {
      setJoinStatus("invalid");
      setJoinError(cause instanceof Error ? cause.message : "Could not reach the room. Try again.");
    }
  }

  return (
    <Shell>
      <div className="elo-page max-w-5xl flex-1">
        <div className="elo-hero grain p-6 sm:p-10">
          <p className="font-mono text-xs uppercase text-[#dfd6ac]">Real-time Hold’em</p>
          <h1 className="mt-2 font-display text-4xl leading-none sm:text-5xl lg:text-6xl">Bring your own table.</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#e3e7d9] sm:text-base">
            Invite one to five friends, start with $1,500 in play chips each, and play until one seat holds the table.
          Private games are unranked. For rated play, find an opponent in the ranked queue.
          </p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <section className="elo-panel flex flex-col gap-3 p-5 sm:p-6">
            <h2 className="font-display text-3xl">Host a game</h2>
            <p className="flex-1 text-sm text-ink-soft">Share a private link. You decide when the table starts.</p>
            <TactileButton variant="accent" className="h-11" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create room"}</TactileButton>
          </section>
          <form className="elo-panel flex flex-col gap-3 p-5 sm:p-6" onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}>
            <label htmlFor="room-code" className="font-display text-3xl">Join a game</label>
            <p id="room-code-help" className="text-xs leading-relaxed text-ink-soft">Enter or paste the 6-character code from your host.</p>
            <OneTimeCode id="room-code" value={code} status={joinStatus}
              describedBy={`room-code-help${joinError ? " room-code-error" : ""}`}
              onChange={value => { setCode(value); setJoinStatus("idle"); setJoinError(""); }} />
            {joinError && <p id="room-code-error" role="alert" className="text-xs text-carmine-deep">{joinError}</p>}
            <TactileButton type="submit" className="h-11 w-full" disabled={code.length !== ROOM_CODE_LENGTH || joinStatus === "checking" || joinStatus === "valid"}>
              {joinStatus === "checking" ? "Checking room…" : joinStatus === "valid" ? "Opening room…" : "Join room"}
            </TactileButton>
          </form>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-carmine-deep">{error}</p>}
      </div>
    </Shell>
  );
}

function LiveRoom({ code }: { code: string }) {
  const router=useRouter();
  const [clockOffset, setClockOffset] = useState(0);
  const [room, setRoom] = useState<LiveSnapshot | null>(null);
  const [failure, setFailure] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const compact = useCompactTable();
  const compactGame = compact && room?.status === "playing" && !failure;

  useEffect(()=>{
    if(room?.status==='closed'&&room.ranked?.proposal&&!room.game)router.replace('/ranked');
  },[room,router]);

  useEffect(() => {
    if (room?.ranked && room.status === "finished") void useFelt.getState().refreshLadder();
  }, [room?.status, Boolean(room?.ranked)]);

  useEffect(() => {
    const controller = new AbortController();
    let stream: EventSource | undefined;
    const url = `/api/live/${encodeURIComponent(code)}`;
    const accept = (value: LiveSnapshot) => setRoom((current) => !current || value.revision >= current.revision ? value : current);
    void (async () => {
      try {
        const sentAt = Date.now();
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not open the room.");
        if (controller.signal.aborted) return;
        setFailure("");
        if (Number.isFinite(data.room.serverNow)) setClockOffset(serverClockOffset(data.room.serverNow, sentAt, Date.now()));
        accept(data.room);
        if (data.room.status === "closed" || data.room.status === "finished") return;
        stream = new EventSource(`${url}/events`);
        stream.onmessage = (event) => {
          const value: LiveSnapshot = JSON.parse(event.data);
          accept(value);
          setConnected(true);
          if (value.status === "closed" || value.status === "finished") stream?.close();
        };
        stream.onerror = () => setConnected(false);
        stream.addEventListener("expired", () => {
          stream?.close();
          setFailure("This room has expired.");
        });
      } catch (cause) {
        if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : "Could not open the room.");
      }
    })();
    return () => { controller.abort(); stream?.close(); };
  }, [attempt, code]);

  async function send(command: LiveCommand) {
    if (!room || busy) return;
    setActionError("");
    setBusy(true);
    try {
      const response = await postGameCommand(`/api/live/${encodeURIComponent(code)}`, { revision: room.revision, command }, {owner:useFelt.getState().profile?.id});
      const data = await response.json();
      if (data.room) setRoom((current) => !current || data.room.revision >= current.revision ? data.room : current);
      if (!response.ok) setActionError(data.error ?? "Could not send your move.");
    } catch {
      setActionError("Connection lost. Wait for the table to reconnect and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!failure && room?.status === "finished" && room.me >= 0) {
    return <LiveReceipt room={room} />;
  }

  return (
    <main className={compactGame ? "compact-game mx-auto max-w-5xl" : "elo-page"}>
      <LiveHeader compact={compactGame} actions={compactGame && room?.game ? (
        <Dialog>
          <DialogTrigger asChild>
            <TactileButton variant="ghost" className="size-11 px-0" aria-label="Table details"><List size={18} aria-hidden /></TactileButton>
          </DialogTrigger>
          <DialogContent className="compact-sheet bg-paper">
            <DialogTitle className="pr-10 font-display text-3xl">Table details</DialogTitle>
            <DialogDescription className="sr-only">Shuffle proof and recent actions.</DialogDescription>
            <LiveDetails game={room.game} />
          </DialogContent>
        </Dialog>
      ) : null} />
      {failure ? (
        <section className="elo-panel p-6">
          <h1 className="font-display text-4xl">Room unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-ink-soft">{failure}</p>
          <div className="mt-4 flex items-center gap-4">
            <TactileButton onClick={() => { setFailure(""); setAttempt((n) => n + 1); }}>Retry</TactileButton>
            <Link href="/live" className="elo-link text-sm">All live rooms</Link>
          </div>
        </section>
      ) : !room ? (
        <p role="status">Opening the room…</p>
      ) : (
        <>
          <div className={compactGame ? "sr-only" : "mb-4 flex flex-wrap items-end justify-between gap-3"}>
            <div>
              <p className="label">{room.ranked ? "Ranked Hold’em · 10 hands" : `Private Hold’em · ${room.code}`}</p>
              <h1 className="mt-1 font-display text-4xl sm:text-5xl">{room.status === "waiting" ? "The waiting room" : room.status === "closed" ? "Room closed" : room.ranked ? "Ranked match" : "Live table"}</h1>
            </div>
            {room.status === "waiting" && !room.ranked && (
              <TactileButton variant="paper" className="h-11" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                } catch {
                  setActionError("Copy the address from your browser to invite a player.");
                }
              }}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? "Link copied" : "Copy invite link"}
              </TactileButton>
            )}
          </div>
          {room.ranked && room.status === "playing" && (
            <div className={cn("flex shrink-0 items-center justify-between gap-3 rounded-lg border border-hairline bg-paper px-2.5 py-1.5", compactGame ? "mb-1 text-[11px]" : "mb-4 text-sm")} aria-label="Match score">
              <span className="tnum shrink-0 font-mono">{room.ranked.completedHands}/{room.ranked.hands} played</span>
              <span className="min-w-0 truncate">
                Your total <strong className="tnum font-mono">{signedChips(room.ranked.scores[room.me] ?? 0)}</strong>
              </span>
            </div>
          )}
          {room.ranked?.outcome?.kind === 'void' && <p role="status" className="mb-4 text-sm text-ink-soft">Match voided. Ratings are unchanged.</p>}
          {!compactGame && !connected && room.status === "playing" && <p role="status" className="mb-2 text-sm text-ink-soft">Reconnecting to the live table…</p>}
          {room.status === "waiting" && room.ranked?.proposal ? (
            <RankedReady room={room} busy={busy} send={send} clockOffset={clockOffset} />
          ) : room.status === "waiting" ? (
            <section className="elo-panel p-5 sm:p-7">
              <div className="flex items-center gap-2 text-sm text-ink-soft"><Users size={18} aria-hidden /> {room.seats.length} of {LIVE_CAPACITY} seats claimed</div>
              <ul className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
                {Array.from({ length: LIVE_CAPACITY }, (_, idx) => {
                  const seat = room.seats[idx];
                  return <li key={idx} className="min-w-0 break-words rounded-xl border border-hairline bg-canvas/55 px-3 py-2.5 text-sm sm:px-4 sm:py-3">
                    {seat ? <><strong>{seat.name}</strong> <span className="text-ink-faint">{idx === room.host ? "· Host" : ""}{idx === room.me ? " · You" : ""}</span></> : <span className="text-ink-faint">Open seat</span>}
                  </li>;
                })}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {room.me < 0 ? (
                  <TactileButton variant="accent" className="h-11" disabled={busy || room.seats.length >= LIVE_CAPACITY} onClick={() => void send({ type: "join" })}>Take a seat</TactileButton>
                ) : room.me === room.host ? (
                  <TactileButton variant="accent" className="h-11" disabled={busy || room.seats.length < 2} onClick={() => void send({ type: "start" })}>Start game</TactileButton>
                ) : <span className="text-sm text-ink-soft">Waiting for the host to start the game.</span>}
                {room.me >= 0 && <TactileButton variant="ghost" className="h-11" disabled={busy} onClick={() => void send({ type: "leave" })}>Leave seat</TactileButton>}
              </div>
            </section>
          ) : room.game ? (
            <LiveFelt room={room} clockOffset={clockOffset} compact={compact} busy={busy} send={send} connected={connected} error={actionError} />
          ) : <Link href="/live" className="elo-link">Create or join another room</Link>}
          {!compactGame && actionError && <p role="alert" className="mt-3 text-sm text-carmine-deep">{actionError}</p>}
        </>
      )}
    </main>
  );
}

function LiveReceipt({ room }: { room: LiveSnapshot }) {
  const me = room.standings.find((entry) => entry.idx === room.me)!;
  const rating = room.ranked?.ratings?.[room.me];
  const before = rating?.before ?? room.seats[room.me].rating;
  return <Receipt
    mode={room.ranked ? "ranked" : "private"}
    outcomeNote={room.ranked?.outcome?.kind === 'forfeit' ? (me.place === 1 ? 'Won by forfeit' : 'Lost by forfeit') : undefined}
    reference={room.code}
    player={me.name}
    seat={room.me + 1}
    seats={room.seats.length}
    hands={room.ranked?.completedHands ?? room.game!.handNo}
    finalStack={me.stack}
    net={me.net}
    place={me.place}
    ratingBefore={before}
    ratingAfter={rating?.after ?? before}
    standings={room.standings.map((entry) => ({
      name: entry.name, place: entry.place, amount: room.ranked ? entry.net : entry.stack,
      isMe: entry.idx === room.me,
      ratingBefore: room.ranked?.ratings?.[entry.idx]?.before,
      ratingAfter: room.ranked?.ratings?.[entry.idx]?.after,
    }))}
    actions={<>
      <Link href="/ranked?queue=1" className="tactile inline-flex min-h-12 items-center justify-center rounded-xl bg-ink px-4 text-center font-mono text-xs font-semibold text-paper hover:bg-[#323c34]">
        {room.ranked ? "Find next ranked match" : "Play ranked"}
      </Link>
      <Link href="/live" className="tactile inline-flex min-h-12 items-center justify-center rounded-xl border border-hairline-dark bg-paper px-4 text-center font-mono text-xs text-ink hover:bg-canvas">Play with friends</Link>
    </>}
  />;
}

function RankedReady({room,busy,send,clockOffset}:{room:LiveSnapshot;busy:boolean;send:(command:LiveCommand)=>Promise<void>;clockOffset:number}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[]);
  const proposal=room.ranked!.proposal!;
  const seconds=secondsToDeadline(proposal.deadline,now,clockOffset,15);
  const accepted=proposal.accepted[room.me];
  return <section className="elo-panel space-y-4 p-5 sm:p-7" aria-label="Ranked ready check">
    <h2 className="font-display text-3xl">Confirm your ranked match</h2>
    <p className="text-sm text-ink-soft">Confirm within <span className="tnum">{seconds}</span> seconds. Cards are dealt when both players confirm.</p>
    <ul className="space-y-2">{room.seats.map((seat,index)=><li key={index}>{seat.name} · {proposal.accepted[index]?'Confirmed':'Waiting'}</li>)}</ul>
    <div className="flex flex-wrap gap-3">
      <TactileButton variant="accent" disabled={busy||accepted||seconds===0} onClick={()=>void send({type:'ready',accept:true})}>{accepted?'Confirmed':'I’m ready'}</TactileButton>
      <TactileButton disabled={busy||seconds===0} onClick={()=>void send({type:'ready',accept:false})}>Decline</TactileButton>
    </div>
  </section>;
}

function LiveFelt({ room, compact, busy, send, connected, error, clockOffset }: {
  room: LiveSnapshot;
  clockOffset: number;
  compact: boolean;
  busy: boolean;
  send: (command: LiveCommand) => Promise<void>;
  connected: boolean;
  error: string;
}) {
  const game = room.game!;
  const mySeat = room.seats[room.me];
  const legal = game.legal;
  const [now, setNow] = useState(() => Date.now());
  const [raise, setRaise] = useState("");
  const [dealtHand, setDealtHand] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDealtHand(game.handNo), 620);
    return () => clearTimeout(timer);
  }, [game.handNo]);
  const dealing = game.phase === "betting" && game.handNo !== dealtHand && game.board.length === 0;
  const runout = isRunout(game.log);
  const deadline = room.nextAt ? secondsToDeadline(room.nextAt, now, clockOffset, HUMAN_TURN_MS / 1000) : 0;
  const active = room.seats[game.toAct];
  const award = game.awards[0];
  const winner = award ? room.seats[award.seatIdx] : null;
  const raiseAmount = raise === "" ? legal?.minRaiseTo ?? 0 : Number(raise);
  const playing = room.status === "playing";
  const status = dealing ? "Shuffling the deck" : legal ? "Your turn" : active ? `${active.name} to act`
    : mySeat?.out ? "You’re out of chips" : "Settling the hand";
  const holeCards = (seat: LiveSnapshot["seats"][number], width: number) => (
    !dealing && seat.idx !== room.me && !seat.out && !seat.folded &&
    Array.from({ length: seat.cardCount }, (_, i) => (
      <PlayingCard key={`${game.handNo}-${i}`} card={seat.cards[i]} width={width} faceDown={!seat.cards[i]}
        deal dealDelay={holeCardDelay(room.seats, game.button, seat.idx, i)}
        flip={Boolean(seat.cards[i])} flipDelay={runout ? 1_350 : 150} from={{ x: 0, y: 24 }} />
    ))
  );
  const playerCards = mySeat && !dealing && mySeat.cards.length > 0 && (
    <FanHand key={game.handNo} cards={mySeat.cards} width={compact ? 55 : 68} reveal={!mySeat.folded}
      from={{ x: 0, y: -24 }} dealDelays={[holeCardDelay(room.seats, game.button, room.me, 0), holeCardDelay(room.seats, game.button, room.me, 1)]} />
  );

  return (
    <div className={compact ? "flex min-h-0 flex-1 flex-col" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]"}>
      <div className={cn("min-w-0", compact && playing && "compact-scroll")}>
        <div className={compact ? "compact-stage" : "space-y-4"}>
          <div className={compact ? "compact-seats" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
            {room.seats.filter((seat) => !compact || seat.idx !== room.me).map((seat) => {
              const detail = game.awards.find(award => award.seatIdx === seat.idx)?.hand ?? (seat.out ? "Out" : seat.folded ? "Folded" : seat.allIn ? "All-in" : seat.lastAction);
              if (compact) return (
                <CompactSeat key={seat.idx} name={seat.name} stack={seat.stack} cards={holeCards(seat, 25)}
                  dealer={seat.idx === game.button} active={seat.idx === game.toAct} muted={seat.out || seat.folded}
                  bet={seat.bet} detail={<span className="truncate text-ink-soft">{detail}</span>} />
              );
              return (
                <div key={seat.idx} className={cn("elo-panel flex min-w-0 items-center gap-2 px-3 py-2", seat.idx === game.toAct && "ring-2 ring-money", (seat.out || seat.folded) && "opacity-55")}>
                  {seat.idx === game.button && <DealerButton size={18} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{seat.name}{seat.idx === room.me && " · You"}</div>
                    <div className="tnum text-xs text-ink-soft">{dollars(seat.stack)}{detail && ` · ${detail}`}</div>
                  </div>
                  <div className="flex shrink-0 -space-x-1.5 empty:hidden">{holeCards(seat, 27)}</div>
                  {seat.bet > 0 && <ChipStack amount={seat.bet} size={15} max={4} />}
                </div>
              );
            })}
          </div>

          <div className={cn("table-felt grain relative", compact ? "compact-felt rounded-2xl" : "min-h-[245px] rounded-[1.65rem] px-6 py-5")}>
            <div className="table-felt-line absolute inset-2 rounded-[1.2rem]" aria-hidden />
            <AnimatePresence>
              {dealing && <motion.div className="pointer-events-none absolute inset-0 z-20" exit={{ opacity: 0 }}><ShuffleFX /></motion.div>}
            </AnimatePresence>
            <div className={cn("relative flex w-full items-center justify-center gap-2", !compact && "mb-3")}>
              <span className="whitespace-nowrap font-mono text-[10px] uppercase text-[#ece5cc]">
                {compact ? `Hand ${game.handNo}${room.ranked ? "/10" : ""} · ${game.sb}/${game.bb}` : `Hand ${game.handNo}${room.ranked ? " of 10" : ""} · Blinds ${game.sb}/${game.bb} · ${game.street}`}
              </span>
              {compact && <span className="tnum flex min-h-7 items-center gap-1.5 rounded-full bg-paper px-2 text-xs font-semibold">
                {game.pot > 0 && <ChipCluster amount={game.pot} size={14} maxPer={3} maxCols={1} />}
                Pot {dollars(game.pot)}
              </span>}
            </div>
            <div className={cn("relative mx-auto", compact ? "compact-community" : "grid w-full max-w-[29.25rem] grid-cols-5 gap-2")}>
              {Array.from({ length: 5 }, (_, idx) => {
                const card = game.board[idx];
                return card ? (
                  <PlayingCard key={`${game.handNo}-${card.id}`} card={card} width="100%" deal flip
                    dealDelay={boardCardDelay(idx, runout)} flipDelay={boardCardDelay(idx, runout)} from={{ x: 0, y: -6 }} />
                ) : <CardSlot key={idx} width="100%" />;
              })}
            </div>
            <div className={cn("relative flex w-full items-center justify-center gap-2", compact ? "min-h-5 text-[11px] font-semibold text-[#f7f0d8]" : "mt-3 min-h-8")} aria-live="polite">
              {!compact && game.pot > 0 && <ChipCluster amount={game.pot} size={23} />}
              <AnimatePresence mode="wait">
                <motion.span key={winner ? `${game.handNo}-${winner.idx}` : "pot"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}
                  transition={{ delay: winner && runout ? 1.75 : 0 }}
                  className={compact ? "max-w-full break-words px-1" : "max-w-full rounded-full bg-paper px-3 py-1 text-center text-sm font-semibold"}>
                  {winner ? `${winner.name} · ${award.hand} · ${dollars(award.amount)}` : compact ? game.street === "preflop" ? "Pre-flop" : game.street : `Pot ${dollars(game.pot)}`}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          {!playing ? (
            <section className={cn("elo-panel p-5", compact && "compact-player")}>
              <h2 className="font-display text-3xl">{room.ranked ? "Match complete" : "Final standings"}</h2>
              <ol className="mt-3 space-y-2 text-sm">{room.standings.map((seat) => {
                const rating = room.ranked?.ratings?.[seat.idx];
                const delta = rating ? rating.after - rating.before : 0;
                return (
                  <li key={seat.idx} className="border-b border-hairline py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-words">{seat.place === 0 ? "Draw · " : `${seat.place}. `}{seat.name}</span>
                      <span className="tnum shrink-0 font-mono">{room.ranked ? signedChips(seat.net) : dollars(seat.stack)}</span>
                    </div>
                    {rating && <p className="tnum mt-1 font-mono text-xs text-ink-soft">{rating.before.toLocaleString("en-US")} → {rating.after.toLocaleString("en-US")} <span className={cn(delta > 0 && "text-money-deep", delta < 0 && "text-carmine-deep")}>({delta > 0 ? "+" : ""}{delta})</span></p>}
                  </li>
                );
              })}</ol>
              <p className="mt-4 text-sm text-ink-soft">{room.ranked ? "All ten hands are saved. Your next match uses this new rating." : "Private game complete. Find a ranked opponent to play for rating."}</p>
              <Link href="/ranked?queue=1" className="tactile mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-money px-4 text-sm font-semibold text-paper hover:bg-money-deep">
                {room.ranked ? "Find next ranked match" : "Play ranked"}
              </Link>
            </section>
          ) : compact ? (
            mySeat ? <CompactPlayer name={mySeat.name} stack={mySeat.stack} bet={mySeat.bet} cards={playerCards} dealer={room.me === game.button} />
              : <p className="compact-player elo-panel grid place-items-center text-sm">Watching this table</p>
          ) : (
            <div className="elo-panel flex flex-wrap items-center justify-between gap-3 p-4">
              {playerCards}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold" aria-live="polite">{status}</p>
                {active && <p className="tnum mt-1 text-xs text-ink-soft">{deadline}s remaining</p>}
                {legal && !dealing && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <TactileButton variant="paper" disabled={busy} onClick={() => void send({ type: "act", action: { type: "fold" } })}>Fold</TactileButton>
                    <TactileButton disabled={busy} onClick={() => void send({ type: "act", action: { type: legal.canCheck ? "check" : "call" } })}>
                      {legal.canCheck ? "Check" : `Call ${dollars(legal.callAmount)}`}
                    </TactileButton>
                    {legal.canRaise && (
                      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        void send({ type: "act", action: { type: "raise", to: raiseAmount } });
                        setRaise("");
                      }}>
                        <input type="number" aria-label="Raise to" min={legal.minRaiseTo} max={legal.maxRaiseTo} step={1}
                          value={raiseAmount} onChange={(event) => setRaise(event.target.value)} className="elo-input w-24 py-1 text-sm" />
                        <TactileButton type="submit" variant="accent" disabled={busy}>Raise</TactileButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {compact && playing ? (
        <MobileBettingDock legal={dealing ? null : legal} busy={busy} status={connected ? status : "Reconnecting to the live table…"}
          currentBet={Math.max(...room.seats.map((seat) => seat.bet))} playerBet={mySeat?.bet ?? 0}
          pot={game.pot} seconds={active ? deadline : undefined} error={error}
          onAction={(action) => void send({ type: "act", action })} />
      ) : (
        <aside className="min-w-0 space-y-4"><LiveDetails game={game} /></aside>
      )}
    </div>
  );
}

function LiveDetails({ game }: { game: NonNullable<LiveSnapshot["game"]> }) {
  const proof = game.deckSeed ? verifyDeck(game.deckSeed, game.deckCommit) : null;
  return (
    <>
      <details className="elo-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">Fair deal</summary>
        <p className="mt-2 break-all font-mono text-[10px] text-ink-soft">{game.deckCommit}</p>
        <p className="mt-2 text-xs text-ink-soft">{proof ? proof.valid ? "Verified. The seed reproduces this shuffle." : "Shuffle verification failed." : "The seed is revealed after the hand."}</p>
        {game.deckSeed && <p className="mt-2 break-all font-mono text-[10px] text-ink-soft">{game.deckSeed}</p>}
      </details>
      <section className="elo-panel p-4">
        <h2 className="font-display text-2xl">Hand log</h2>
        <ol className="quiet-scroll mt-2 max-h-72 overflow-y-auto text-xs leading-relaxed text-ink-soft">
          {game.log.slice().reverse().map((entry) => <li key={entry.seq} className="border-b border-hairline py-1.5 last:border-0">{entry.text}</li>)}
        </ol>
      </section>
    </>
  );
}
