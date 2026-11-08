"use client";

// ---------------------------------------------------------------------------
// Table — six seats on a racetrack of felt. Nameplates sit OUTSIDE the rail;
// only cards and chips touch the felt. The deck riffles between hands, cards
// fly the real line from the deck on a spring, community cards land face-down
// and turn over, chips are pushed, swept to the middle, and pushed again to
// whoever takes the pot. Every decision runs against a clock the whole table
// can see.
// ---------------------------------------------------------------------------

import { CASH_OUT_MIN_HANDS, useFelt, type TurnClock } from "@/store/game";
import { displayPot, type GameState, type Seat } from "@/lib/poker/engine";
import { evaluate } from "@/lib/poker/evaluator";
import { verifyDeck } from "@/lib/poker/cards";
import { boardCardDelay, holeCardDelay, isRunout } from "@/lib/poker/deal-timing";
import { RollingNumber, Stamp, TactileButton } from "@/components/felt/kit";
import { CardSlot, FanHand, PlayingCard } from "@/components/felt/playing-card";
import { ChipCluster, ChipStack, DealerButton } from "@/components/felt/chips";
import { ShuffleFX } from "@/components/felt/shuffle";
import { chipsLabel, CompactPlayer, CompactSeat, MobileBettingDock, useCompactTable } from "@/components/felt/mobile-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { ArrowLeft, Volume2, VolumeX, List, Lock, ShieldCheck, Check, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- layout ---
// Stage coordinates. The rail is 940×452 centred at (500, 300); plates live
// outside it, cards and bets live on the felt.
const TABLE_W = 1000;
const TABLE_H = 600;
const DECK = { x: 500, y: 279 }; // the deck lives at the centre of the felt
const POT = { x: 118, y: 252 }; // where swept chips collect, left of the board

// nameplate centres — all six sit OUTSIDE the rail
const SEAT_POS: { x: number; y: number }[] = [
  { x: 500, y: 566 }, // you, below the rail
  { x: 894, y: 504 }, // bottom-right corner, outside the curve
  { x: 806, y: 56 }, // top-right, above the rail
  { x: 500, y: 30 }, // top-centre, above the rail
  { x: 194, y: 56 }, // top-left, above the rail
  { x: 106, y: 504 }, // bottom-left corner, outside the curve
];

// where each seat's hole cards rest on the felt
const CARD_POS: { x: number; y: number }[] = [
  { x: 500, y: 452 }, // you
  { x: 872, y: 392 },
  { x: 806, y: 176 },
  { x: 500, y: 138 },
  { x: 194, y: 176 },
  { x: 128, y: 392 },
];

// where each seat's street bet sits on the felt, between cards and pot
const BET_POS: { x: number; y: number }[] = [
  { x: 500, y: 374 },
  { x: 742, y: 336 },
  { x: 688, y: 210 },
  { x: 500, y: 190 },
  { x: 312, y: 210 },
  { x: 258, y: 336 },
];

const BUTTON_POS: { x: number; y: number }[] = [
  { x: 608, y: 444 },
  { x: 802, y: 400 },
  { x: 742, y: 142 },
  { x: 566, y: 142 },
  { x: 258, y: 142 },
  { x: 198, y: 400 },
];

// flight vector from the deck to each seat's resting cards (deck − rest)
const DEAL_FROM: { x: number; y: number }[] = CARD_POS.map((p) => ({
  x: DECK.x - p.x,
  y: DECK.y - p.y,
}));

const dimWhileShuffling = (shuffling: boolean): React.CSSProperties => ({
  opacity: shuffling ? 0 : 1,
  transition: `opacity ${DUR.base * 1000}ms ease`,
});

// ---------------------------------------------------------------- cash out ---
// The seat is a commitment: ten completed hands before the chips can leave.
// The meter is the contract — one notch per hand, filled as the hand settles.
function CashOutMeter({ done, min, unlocked }: { done: number; min: number; unlocked: boolean }) {
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: min }).map((_, i) => {
        const filled = i < done;
        return (
          <motion.span
            key={i}
            className={cn(
              "h-[13px] w-[3px] rounded-full",
              filled ? (unlocked ? "bg-money" : "bg-ink") : "bg-hairline-dark",
            )}
            initial={false}
            animate={{ scaleY: filled ? 1 : 0.55, opacity: filled ? 1 : 0.7 }}
            transition={{ ...SPRING.plate, delay: filled ? (done - i - 1) * 0.012 : 0 }}
          />
        );
      })}
    </div>
  );
}

/** The seal on the deck: commit now, seed when the hand is over, verify anytime. */
function FairnessPanel({
  s,
  lastProof,
  compact,
}: {
  s: GameState;
  lastProof: { handNo: number; seed: string; commit: string } | null;
  compact: boolean;
}) {
  // while a hand is live its seed stays sealed; once it settles the proof is
  // kept, so the panel is auditable between hands too
  const settled = s.phase === "showdown" || s.phase === "hand-end" || s.phase === "session-end";
  const current = settled && s.deckSeed ? { handNo: s.handNo, seed: s.deckSeed, commit: s.deckCommit } : null;
  const source = current ?? lastProof;
  const proof = source ? verifyDeck(source.seed, source.commit) : null;
  const short = (v: string, n = 18) => (v ? `${v.slice(0, n)}…` : "—");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className={cn("flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-paper font-mono text-[9px] uppercase text-ink-soft transition-colors hover:border-ink/40 hover:text-ink", compact ? "size-11" : "h-8 px-2.5")}
          aria-label="Provably fair deck"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {!compact && <span className="hidden sm:inline">fair deal</span>}
        </button>
      </DialogTrigger>
      <DialogContent className={cn("border-hairline bg-paper", compact ? "compact-sheet" : "rounded-2xl sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">The deal is sealed</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 text-[13px] leading-relaxed text-ink-soft">
          <p>
            Every hand is shuffled from a fresh 256-bit seed with ChaCha20 and an unbiased
            Fisher–Yates pass. Before a single card moves, the deck order is hashed and the hash is
            posted. The seed is revealed when the hand ends.
          </p>
          <div className="rounded-xl border border-hairline bg-canvas/70 px-4 py-3 font-mono text-[10.5px] leading-relaxed">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-faint">{current ? "this hand" : "last settled"}</span>
              <span className="tnum">#{source?.handNo ?? s.handNo}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-ink-faint">commit</span>
              <span className="tnum truncate" title={source?.commit ?? s.deckCommit}>
                {short(source?.commit ?? s.deckCommit)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-ink-faint">seed</span>
              <span className={cn("tnum truncate", !source && "text-ink-faint")} title={source?.seed}>
                {source ? short(source.seed) : "sealed until the hand ends"}
              </span>
            </div>
            {source ? (
              <div className="mt-2 select-all break-all border-t border-hairline pt-2 text-[9.5px] leading-relaxed text-ink-faint">
                {source.seed}
              </div>
            ) : null}
          </div>
          {proof ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[10px] uppercase ",
                proof.valid ? "border-money/40 bg-money/[0.06] text-money" : "border-carmine/40 bg-carmine/[0.06] text-carmine",
              )}
            >
              {proof.valid ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {proof.valid
                ? "replayed — the seed reproduces the posted commit"
                : "mismatch — do not trust this hand"}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 font-mono text-[10px] uppercase text-ink-faint">
              <Lock className="h-3.5 w-3.5" /> sealed while the hand is live
            </div>
          )}
          <p className="text-[12px] text-ink-faint">
            The bots never see the deck either: a bot decides from its own two cards and the public
            board, so peeking is not a rule it follows — it is information it does not have.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HoldToConfirm({
  onConfirm,
  disabled,
  children,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  };

  const begin = () => {
    if (disabled) return;
    start.current = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start.current) / 650);
      setProgress(p);
      if (p >= 1) {
        stop();
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => stop, []);

  return (
    <button
      className={cn(
        "relative whitespace-nowrap overflow-hidden rounded-lg border border-carmine-deep bg-paper px-2.5 py-1 font-mono text-[10px] font-semibold uppercase text-carmine transition-colors",
        !disabled && "hover:bg-carmine hover:text-paper",
        disabled && "opacity-40",
      )}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      disabled={disabled}
      aria-label="Hold to go all-in"
    >
      <span
        className="absolute inset-0 bg-carmine/15"
        style={{ transformOrigin: "left", transform: `scaleX(${progress})` }}
        aria-hidden
      />
      <span className="relative">{children}</span>
    </button>
  );
}

// ------------------------------------------------------------ turn clock ---
/** The decision clock every seat shows while it is their turn. */
function TurnBar({ clock, urgent }: { clock: TurnClock; urgent?: boolean }) {
  return (
    <span className="absolute inset-x-[9px] bottom-[5px] block h-[3px] overflow-hidden rounded-full bg-hairline">
      <motion.span
        key={`${clock.seat}-${clock.start}`}
        className={cn("block h-full rounded-full", urgent ? "bg-carmine" : "bg-ink/75")}
        initial={{ width: "100%" }}
        animate={{ width: "0%" }}
        transition={{ duration: clock.duration / 1000, ease: "linear" }}
      />
    </span>
  );
}

/** The right-hand slot of a plate: what the seat is doing right now. */
function SeatStatus({ s, seat, isYou, awaitingHuman, shotClock }: {
  s: GameState;
  seat: Seat;
  isYou: boolean;
  awaitingHuman: boolean;
  shotClock: number;
}) {
  if (seat.out) return <span className="font-mono text-[9px] uppercase text-ink-faint">busted</span>;
  if (isYou && awaitingHuman) {
    return (
      <span className={cn("tnum font-mono text-[10px] font-semibold leading-none", shotClock <= 8 ? "text-carmine" : "text-ink")}>
        {shotClock}s
      </span>
    );
  }
  if (seat.allIn) return <span className="font-mono text-[9px] font-bold uppercase text-carmine">all-in</span>;
  if (seat.folded) return <span className="font-mono text-[9px] uppercase text-ink-faint">fold</span>;
  if (s.phase === "betting" && s.toAct === seat.idx && !isYou) {
    return (
      <span className="think-dots font-mono text-[10px] leading-none text-ink-faint">
        <span>·</span><span>·</span><span>·</span>
      </span>
    );
  }
  if (!isYou && seat.lastAction && s.phase === "betting") {
    return <span className="truncate font-mono text-[9px] uppercase text-ink-soft">{seat.lastAction}</span>;
  }
  return null;
}

/** The nameplate — one fixed 196×56 grid used by every seat, so all six
    plates align: name + stack on the top row, rating + status below. */
function SeatPlate({
  s, seat, clock, awaitingHuman, shotClock, winner,
}: {
  s: GameState;
  seat: Seat;
  clock: TurnClock | null;
  awaitingHuman: boolean;
  shotClock: number;
  winner: boolean;
}) {
  const isYou = seat.isHuman;
  const active = s.phase === "betting" && s.toAct === seat.idx && !seat.out;
  const dimmed = seat.out || (seat.folded && !seat.revealed);
  const urgent = isYou && awaitingHuman && shotClock <= 8;
  return (
    <motion.div
      className={cn(
        "relative h-[56px] w-[196px] rounded-xl border bg-paper px-3 pt-[9px]",
        dimmed ? "border-hairline opacity-45 saturate-50" : "border-hairline",
        active && "z-10 border-ink/70 shadow-[0_3px_0_0_var(--color-hairline-dark)]",
        winner && "border-money shadow-[0_3px_0_0_var(--color-money)]",
      )}
      animate={{ scale: active ? 1.03 : 1 }}
      transition={SPRING.plate}
    >
      {active ? <span className="absolute -left-[5px] top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-carmine" /> : null}
      <div className="flex items-center justify-between gap-2 leading-none">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px] leading-none", isYou ? "font-semibold" : "font-medium")}>{seat.name}</span>
          {isYou ? <span className="shrink-0 font-mono text-[7.5px] font-bold text-carmine">YOU</span> : null}
        </div>
        <RollingNumber value={seat.stack} className="tnum shrink-0 font-mono text-[14.5px] font-semibold leading-none" />
      </div>
      <div className="mt-[8px] flex h-[13px] items-center justify-between gap-2 leading-none">
        <span className="tnum shrink-0 font-mono text-[9px] text-ink-faint" title="rating">
          {seat.out ? "—" : seat.rating.toLocaleString("en-US")}
        </span>
        <span className="flex min-w-0 items-center justify-end">
          <SeatStatus s={s} seat={seat} isYou={isYou} awaitingHuman={awaitingHuman} shotClock={shotClock} />
        </span>
      </div>
      {active && clock ? <TurnBar clock={clock} urgent={urgent} /> : null}
    </motion.div>
  );
}

// ------------------------------------------------- compact (mobile) felt ---
function CompactFelt({
  s, lastWinner, folded, levelToast, shuffling,
}: {
  s: GameState;
  lastWinner: { name: string; amount: number; text?: string } | null;
  folded: boolean;
  levelToast: string | null;
  shuffling: boolean;
}) {
  const pot = displayPot(s);
  const human = s.seats.find((seat) => seat.isHuman)!;
  const showdown = s.phase === "showdown";
  const runout = showdown && isRunout(s.log);
  const result = (showdown || s.phase === "hand-end") ? lastWinner : null;

  return (
    <div className="compact-stage select-none">
      <div className="compact-seats">
        {s.seats.filter((seat) => !seat.isHuman).map((seat) => {
          const revealed = showdown && Boolean(seat.revealed);
          const active = s.phase === "betting" && s.toAct === seat.idx;
          return (
            <CompactSeat key={seat.idx} name={seat.name} stack={seat.stack} dealer={s.button === seat.idx}
              active={active} muted={seat.out || (seat.folded && !revealed)}
              winner={showdown && s.awards?.some((award) => award.seatIdx === seat.idx)}
              bet={seat.folded ? 0 : seat.bet}
              detail={<span className="truncate text-ink-soft">{seat.out ? "Out" : seat.folded ? "Folded" : seat.allIn ? "All-in" : active ? "Acting" : seat.lastAction}</span>}
              cards={!seat.out && !shuffling && seat.cards.map((card, i) => (
                <PlayingCard key={`${s.handNo}-${i}`} card={card} width={25} faceDown={!revealed}
                  flip={revealed} flipDelay={(runout ? 1_300 : 0) + i * 90} deal
                  dealDelay={holeCardDelay(s.seats, s.button, seat.idx, i)} from={{ x: 0, y: 24 }} />
              ))} />
          );
        })}
      </div>

      <div className="compact-felt table-felt grain relative rounded-2xl">
        <div className="table-felt-line absolute inset-[5px] rounded-xl" aria-hidden />
        {shuffling && <ShuffleFX />}
        <div className="relative flex min-h-7 w-full items-center justify-center gap-2">
          <span className="font-mono text-[10px] uppercase r text-[#f0e6c6]">{shuffling ? "Shuffling" : s.street === "preflop" ? "Pre-flop" : s.street}</span>
          {pot > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-paper px-2 py-0.5 text-xs font-semibold">
              <ChipCluster amount={pot} size={14} maxPer={3} maxCols={1} />
              <span className="tnum whitespace-nowrap">Pot {chipsLabel(pot)}</span>
            </span>
          )}
        </div>
        <div className="compact-community relative" style={dimWhileShuffling(shuffling)}>
          {Array.from({ length: 5 }, (_, i) => {
            const card = s.board[i];
            return card ? (
              <PlayingCard key={`${s.handNo}-${card.id}`} card={card} width="100%" deal flip
                dealDelay={boardCardDelay(i, runout)} flipDelay={boardCardDelay(i, runout)} from={{ x: 0, y: 22 }} />
            ) : <CardSlot key={i} width="100%" />;
          })}
        </div>
        <div className="relative flex min-h-5 w-full items-center justify-center text-center text-[11px] font-semibold text-[#f7f0d8]">
          <AnimatePresence mode="wait">
            {(result || levelToast) && (
              <motion.span key={result ? `result-${s.handNo}` : levelToast} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="max-w-full truncate px-1" transition={{ delay: result && runout ? 1.75 : 0 }}>
                {result ? `${result.name} takes ${chipsLabel(result.amount)}` : levelToast}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CompactPlayer name={human.name} stack={human.stack} bet={human.bet} dealer={s.button === human.idx}
        cards={<div className="transition-opacity" style={{ opacity: shuffling ? 0 : folded ? 0.45 : 1 }}>
          <FanHand key={s.handNo} cards={human.cards} width={55} reveal={!folded} from={{ x: 0, y: -24 }}
            dealDelays={[holeCardDelay(s.seats, s.button, human.idx, 0), holeCardDelay(s.seats, s.button, human.idx, 1)]} />
        </div>} />
    </div>
  );
}

// ------------------------------------------------------------------ view ---
export function TableView() {
  const { game: s, awaitingHuman, legal, shotClock, muted, tableNo, lastWinner, toggleMute, humanAct, leaveTable, cancelCashOut, settling, shuffling, turn, completedHands, cashOutNudge, cashOutQueued, lastProof } = useFelt();
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // slider resets to the legal minimum each time a new betting decision opens
  const [raiseTo, setRaiseTo] = useState(0);
  const [lastTurnKey, setLastTurnKey] = useState<string | null>(null);
  const turnKey = awaitingHuman && legal ? `${s?.handNo ?? 0}:${legal.minRaiseTo}:${legal.canRaise}` : null;
  if (turnKey !== lastTurnKey) {
    setLastTurnKey(turnKey);
    setRaiseTo(legal?.minRaiseTo ?? 0);
  }

  // blinds toast: shown once per hand that raised the level
  const [toast, setToast] = useState<{ hand: number; text: string | null }>({ hand: -1, text: null });
  if (s && s.levelMarker && toast.hand !== s.handNo) {
    setToast({ hand: s.handNo, text: `Blinds up — ${s.sb}/${s.bb}` });
  }
  useEffect(() => {
    if (!toast.text) return;
    const t = setTimeout(() => setToast((cur) => ({ ...cur, text: null })), 2600);
    return () => clearTimeout(t);
  }, [toast.text, toast.hand]);
  const levelToast = toast.text;

  // cash-out unlock: announce the moment the tenth hand settles, so the player
  // knows the choice is theirs before the next deal starts.
  const [unlockSeen, setUnlockSeen] = useState(false);
  if (!unlockSeen && completedHands >= CASH_OUT_MIN_HANDS) {
    setUnlockSeen(true);
    setToast((cur) => ({ hand: cur.hand, text: "Cash-out unlocked — leave now or keep playing" }));
  }

  const compact = useCompactTable();

  // scale the fixed-size table to its container — width and height both bind
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const row = rowRef.current;
    if (!el || compact) return;
    const measure = () => {
      const byW = el.clientWidth / TABLE_W;
      const byH = row ? (row.clientHeight - 8) / TABLE_H : Infinity;
      setScale(Math.min(1.05, byW, byH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (row) ro.observe(row);
    return () => ro.disconnect();
  }, [compact]);

  // your made hand, once the flop is out
  const human = s?.seats.find((x) => x.isHuman);

  if (!s || !human) return null;

  // recompute plainly each beat — evaluation is 21 five-card combos, cheaper
  // than the memo bookkeeping against a mutable engine state
  let myHandText: string | null = null;
  if (
    !human.folded &&
    s.board.length >= 3 &&
    human.cards.length === 2 &&
    s.phase !== "showdown" &&
    s.phase !== "hand-end"
  ) {
    try {
      myHandText = evaluate([...human.cards, ...s.board]).name.toLowerCase();
    } catch {
      myHandText = null;
    }
  }

  const pot = displayPot(s);
  const net = human.stack - 1500;
  const folded = human.folded;
  const showdown = s.phase === "showdown";
  const runout = showdown && isRunout(s.log);
  const handEnd = s.phase === "hand-end";

  // A zero stack only means "busted" once the hand is over. During a betting
  // round it is an all-in: the seat is still live and must not be cashed out.
  const busted = human.out || (s.phase !== "betting" && human.stack <= 0);
  // Busted seats owe the table nothing. Everyone else must finish ten hands.
  const canCashOut = busted || completedHands >= CASH_OUT_MIN_HANDS;
  // With a hand in flight, the chips leave at the next boundary — not now.
  const waitingForBoundary = canCashOut && !busted && s.phase !== "idle";
  const logNewestFirst = [...s.log].reverse();

  // dealing order: seats are dealt round-robin starting left of the button
  const dealDelayFor = (seatIdx: number, cardRound: number) => holeCardDelay(s.seats, s.button, seatIdx, cardRound);

  const winnerSeat =
    (showdown || handEnd) && lastWinner ? s.seats.find((x) => x.name === lastWinner.name) : undefined;

  // showdown reveals flip in dealing order — the delay counts revealed seats only
  const revealOrder = new Map<number, number>();
  if (showdown) {
    [...s.seats]
      .filter((x) => x.revealed)
      .sort((a, b) => ((a.idx - s.button + s.seats.length) % s.seats.length) - ((b.idx - s.button + s.seats.length) % s.seats.length))
      .forEach((x, i) => revealOrder.set(x.idx, i * 260));
  }

  const presets = legal?.canRaise
    ? (() => {
        const potNow = pot;
        const toCall = legal.callAmount;
        const max = legal.maxRaiseTo;
        const clamp = (v: number) => Math.max(legal.minRaiseTo, Math.min(max, Math.round(v / 5) * 5));
        return [
          { label: "MIN", v: legal.minRaiseTo, hold: false },
          { label: "½ POT", v: clamp(toCall + potNow * 0.5), hold: false },
          { label: "POT", v: clamp(toCall + potNow), hold: false },
          { label: "ALL-IN", v: max, hold: true },
        ];
      })()
    : [];

  return (
    <div className={cn("mx-auto w-full max-w-7xl", compact ? "compact-game" : "flex h-dvh flex-col px-3 sm:px-6")}>
      {/* ---------------------------------------------------------- top bar */}
      <header className={cn("flex shrink-0 items-center justify-between", compact ? "gap-1 py-1" : "gap-3 py-3")}>
        <div className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-3")}>
          <div className="relative shrink-0">
            <TactileButton
              variant="ghost"
              size="sm"
              className={compact ? "size-11 px-0" : "size-8 px-0"}
              onClick={() => (cashOutQueued ? cancelCashOut() : void leaveTable())}
              aria-label={
                cashOutQueued
                  ? "Cancel queued cash-out"
                  : canCashOut
                    ? "Cash out"
                    : "Cash out locked"
              }
              title={
                cashOutQueued
                  ? "Cash-out queued — cancel to keep playing"
                  : !canCashOut
                    ? `${CASH_OUT_MIN_HANDS - completedHands} more hands before you can cash out`
                    : waitingForBoundary
                      ? "Cash out when this hand ends"
                      : "Cash out and settle"
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </TactileButton>
            {!canCashOut ? (
              <span className="pointer-events-none absolute -right-1 -top-1 flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-ink px-[3px] font-mono text-[8px] font-semibold text-paper">
                {CASH_OUT_MIN_HANDS - completedHands}
              </span>
            ) : null}
            {cashOutQueued ? (
              <span className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-money" />
            ) : null}
          </div>
          <div className="min-w-0 truncate">
            <div className="font-mono text-[11px] font-semibold uppercase ">{compact ? "Table" : "Table No."} {tableNo}</div>
            <div className="font-mono text-[9px] uppercase text-ink-faint">
              hand {s.handNo} · {compact ? "" : "blinds "}{s.sb}/{s.bb}
            </div>
          </div>
        </div>
        <div className={cn("flex shrink-0 items-center", compact ? "gap-0.5" : "gap-2")}>
          <FairnessPanel s={s} lastProof={lastProof} compact={compact} />
          <div className={cn("hidden rounded-lg border border-hairline bg-paper px-3 py-1.5 text-right", !compact && "sm:block")}>
            <div className="font-mono text-[9px] uppercase text-ink-faint">net</div>
            <RollingNumber
              value={net}
              signed
              className={cn("font-mono text-[12px] font-semibold", net >= 0 ? "text-money" : net < 0 ? "text-carmine" : "text-ink")}
            />
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <TactileButton variant="ghost" size="sm" className={cn("px-0", compact ? "size-11" : "size-8 lg:hidden")} aria-label="Hand log">
                <List className="h-4 w-4" aria-hidden />
              </TactileButton>
            </DialogTrigger>
            <DialogContent className={cn("bg-paper", compact ? "compact-sheet" : "max-h-[80dvh] overflow-y-auto")}>
              <DialogTitle className="font-display text-3xl">Hand log</DialogTitle>
              <DialogDescription className="sr-only">Recent actions at this table.</DialogDescription>
              <ol className="quiet-scroll max-h-[50dvh] overflow-y-auto">
                {logNewestFirst.map((entry) => <li key={entry.seq} className="border-b border-hairline py-2 text-xs last:border-0">{entry.text}</li>)}
              </ol>
            </DialogContent>
          </Dialog>
          <TactileButton variant="ghost" size="sm" className={cn("px-0", compact ? "size-11" : "size-8")} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </TactileButton>
        </div>
      </header>

      {/* a queued cash-out must be impossible to miss: it names the boundary
          it will happen at, and offers the way back out */}
      <AnimatePresence>
        {!compact && cashOutQueued && waitingForBoundary && !settling ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.fast, ease: EASE.arrival }}
            className="mx-auto mb-1 flex w-full max-w-[640px] items-center justify-between gap-3 rounded-xl border border-ink bg-ink px-3 py-1.5 text-paper"
          >
            <span className="font-mono text-[9px] uppercase ">
              Cash-out queued — chips leave when this hand ends
            </span>
            <button
              onClick={cancelCashOut}
              className="flex items-center gap-1 rounded-lg border border-paper/30 px-2 py-0.5 font-mono text-[9px] uppercase transition-colors hover:bg-paper/10"
            >
              <X className="h-3 w-3" />
              keep playing
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ------------------------------------------------------- the table */}
      <div ref={rowRef} className={compact ? "compact-scroll" : "flex min-h-0 flex-1 items-center justify-center gap-5 overflow-hidden"}>
        {compact ? (
          <CompactFelt s={s} lastWinner={lastWinner} folded={folded} levelToast={levelToast} shuffling={shuffling} />
        ) : (
        <div ref={wrapRef} className="w-full" style={{ maxWidth: TABLE_W }}>
          <div style={{ height: TABLE_H * scale }} className="relative w-full">
            <div
              className="absolute left-1/2 top-0 origin-top -translate-x-1/2"
              style={{ transform: `scale(${scale})`, width: TABLE_W, height: TABLE_H }}
            >
              {/* rail + felt */}
              <div className="table-rail absolute left-1/2 top-[74px] h-[452px] w-[940px] -translate-x-1/2 rounded-[226px]" />
              <div className="table-felt grain absolute left-1/2 top-[88px] h-[424px] w-[912px] -translate-x-1/2 rounded-[212px]">
                <div className="table-felt-line absolute inset-[16px] rounded-[196px]" />
                <div className="table-felt-line table-felt-line-inner absolute inset-[56px] rounded-[156px]" />
              </div>

              {/* pot — chips stacked over the pill, left of the board, clear of
                  every seat's cards and bets */}
              <motion.div
                className="absolute flex flex-col items-start gap-1.5"
                style={{ left: 76, top: 226 }}
                initial={false}
                animate={{ opacity: shuffling ? 0 : 1 }}
                transition={{ duration: DUR.base }}
              >
                <AnimatePresence>
                  {pot > 0 && !showdown && !handEnd ? (
                    <motion.div
                      key={`pot-chips-${s.collected}`}
                      initial={{ opacity: 0, scale: 0.82, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={SPRING.chip}
                    >
                      <ChipCluster amount={pot} size={30} maxPer={6} maxCols={3} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <AnimatePresence>
                  {pot > 0 && !showdown && !handEnd ? (
                    <motion.div
                      key="pot-pill"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: DUR.fast }}
                      className="flex items-baseline gap-2 rounded-full border border-hairline-dark bg-paper px-3.5 py-1 shadow-[0_1.5px_0_var(--color-hairline-dark)]"
                    >
                      <span className="font-mono text-[9px] uppercase text-ink-faint">
                        {s.street === "preflop" ? "pre-flop" : s.street}
                      </span>
                      <span className="h-2.5 w-px bg-hairline-dark" aria-hidden />
                      <RollingNumber value={pot} prefix="$" className="font-mono text-[13px] font-semibold" />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>

              {/* board — cards land face-down, then turn over */}
              <div
                className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2.5"
                style={{ top: 216, ...dimWhileShuffling(shuffling) }}
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const card = s.board[i];
                  return (
                    <div key={i}>
                      {card ? (
                        <PlayingCard
                          key={`${s.handNo}-${card.id}`}
                          card={card}
                          width={90}
                          deal
                          flip
                          dealDelay={boardCardDelay(i, runout)}
                          flipDelay={boardCardDelay(i, runout)}
                          from={{ x: 0, y: 53 }}
                        />
                      ) : (
                        <CardSlot width={90} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* your made hand, once the flop is out */}
              <AnimatePresence>
                {myHandText ? (
                  <motion.div
                    key={myHandText}
                    className="absolute left-1/2 z-10 -translate-x-1/2"
                    style={{ top: 350 }}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: DUR.fast }}
                  >
                    <span className="whitespace-nowrap rounded-full border border-hairline bg-paper/90 px-2.5 py-[2px] font-mono text-[8.5px] uppercase text-ink-soft">
                      {myHandText}
                    </span>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* bets — tossed from each seat, swept to the middle when the
                  street or the hand turns. AnimatePresence custom feeds the
                  latest table context to chips that are already leaving. */}
              <div className="pointer-events-none absolute inset-0" style={dimWhileShuffling(shuffling)}>
                <AnimatePresence
                  initial={false}
                  custom={{ street: s.street, phase: s.phase, handNo: s.handNo }}
                >
                  {s.seats.map((seat) => {
                    const pos = BET_POS[seat.idx];
                    if (seat.bet <= 0) return null;
                    const myStreet = s.street;
                    const myHand = s.handNo;
                    return (
                      <motion.div
                        key={`${s.handNo}-${s.street}-${seat.idx}`}
                        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                        style={{ left: pos.x, top: pos.y }}
                        initial={{
                          x: SEAT_POS[seat.idx].x - pos.x,
                          y: SEAT_POS[seat.idx].y - pos.y,
                          opacity: 0,
                          scale: 0.85,
                          rotate: seat.idx % 2 === 0 ? -3 : 3,
                        }}
                        animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                        variants={{
                          out: (latest: { street: string; phase: string; handNo: number }): TargetAndTransition =>
                            latest.street !== myStreet ||
                            latest.handNo !== myHand ||
                            latest.phase === "showdown" ||
                            latest.phase === "hand-end"
                              ? {
                                  x: POT.x - pos.x,
                                  y: POT.y - pos.y,
                                  opacity: 0,
                                  scale: 0.78,
                                  rotate: seat.idx % 2 === 0 ? 5 : -5,
                                  transition: { duration: DUR.slow, ease: EASE.travel },
                                }
                              : { opacity: 0, scale: 0.92, transition: { duration: DUR.tap } },
                        }}
                        exit="out"
                        transition={SPRING.card}
                      >
                        <ChipStack amount={seat.bet} size={25} max={7} />
                        <span className="tnum rounded-full border border-hairline bg-paper px-2 py-[1px] font-mono text-[10px] font-semibold shadow-[0_1px_2px_rgb(23_21_14/0.15)]">
                          ${seat.bet.toLocaleString("en-US")}
                        </span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* the deck, riffling between hands */}
              <AnimatePresence>
                {shuffling ? (
                  <motion.div
                    key="shuffle"
                    className="absolute inset-0 z-20"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: DUR.fast }}
                  >
                    <ShuffleFX />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* the pot pushed to the winner — it lands on their cards */}
              <AnimatePresence>
                {(showdown || handEnd) && lastWinner && winnerSeat ? (
                  <motion.div
                    key={`take-${s.handNo}`}
                    className="absolute z-30"
                    style={{ left: POT.x, top: POT.y }}
                    initial={{ x: 0, y: 0, opacity: 0, scale: 0.8 }}
                    animate={{
                      x: CARD_POS[winnerSeat.idx].x - POT.x,
                      y: (CARD_POS[winnerSeat.idx].y < 200 ? CARD_POS[winnerSeat.idx].y + 64 : CARD_POS[winnerSeat.idx].y - 56) - POT.y,
                      opacity: [0, 1, 1, 0],
                      scale: [0.8, 1, 1, 0.9],
                      rotate: [0, -2.5, 2, 0],
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DUR.sweep, times: [0, 0.18, 0.82, 1], ease: "easeInOut" }}
                  >
                    <ChipStack amount={lastWinner.amount} size={24} max={9} />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* dealer button */}
              <DealerButton
                size={26}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: BUTTON_POS[s.button].x,
                  top: BUTTON_POS[s.button].y,
                  transition: `left ${DUR.slow * 1000}ms cubic-bezier(${EASE.travel.join(",")}), top ${DUR.slow * 1000}ms cubic-bezier(${EASE.travel.join(",")})`,
                }}
              />

              {/* seats — plates only, outside the rail */}
              {s.seats.map((seat) => {
                const pos = SEAT_POS[seat.idx];
                const winner = showdown && (s.awards?.some((a) => a.seatIdx === seat.idx) ?? false);
                const seatClock = turn && turn.seat === seat.idx ? turn : null;
                return (
                  <div key={seat.idx} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pos.x, top: pos.y }}>
                    <SeatPlate
                      s={s}
                      seat={seat}
                      clock={seatClock}
                      awaitingHuman={awaitingHuman}
                      shotClock={shotClock}
                      winner={winner}
                    />
                  </div>
                );
              })}

              {/* bot hole cards — on the felt, face down; at showdown they turn
                  over in place, in dealing order; folded hands muck to the deck */}
              {s.seats.map((seat) => {
                if (seat.isHuman || seat.out || seat.cards.length !== 2) return null;
                const pos = CARD_POS[seat.idx];
                const from = DEAL_FROM[seat.idx];
                const visible = !seat.folded || seat.revealed;
                return (
                  <AnimatePresence key={`cards-${seat.idx}`}>
                    {visible ? (
                      <motion.div
                        key="hole"
                        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-1"
                        style={{ left: pos.x, top: pos.y, ...dimWhileShuffling(shuffling) }}
                        exit={{
                          x: DECK.x - pos.x,
                          y: DECK.y - pos.y,
                          rotate: pos.x > 500 ? -14 : 14,
                          opacity: 0,
                          transition: { duration: DUR.slow, ease: EASE.travel },
                        }}
                      >
                        {seat.cards.map((c, i) => (
                          <PlayingCard
                            key={`${s.handNo}-${i}`}
                            card={c}
                            width={54}
                            faceDown={!seat.revealed}
                            flip={showdown && !!seat.revealed}
                            flipDelay={revealOrder.get(seat.idx) ?? 0}
                            deal
                            dealDelay={dealDelayFor(seat.idx, i)}
                            from={from}
                          />
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                );
              })}

              {/* your cards, on the felt in front of you */}
              <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 372, ...dimWhileShuffling(shuffling) }}>
                <div className={cn("transition-opacity", folded && "opacity-40 saturate-0")}>
                  <FanHand
                    key={s.handNo}
                    cards={human.cards}
                    width={104}
                    reveal={!folded}
                    from={{ x: 0, y: -173 }}
                    dealDelays={[dealDelayFor(human.idx, 0), dealDelayFor(human.idx, 1)]}
                  />
                </div>
              </div>

              {/* winner banner — lands on the pot, where the chips just were */}
              <AnimatePresence>
                {(showdown || handEnd) && lastWinner ? (
                  <motion.div
                    key="winner"
                    className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: 170, top: 279 }}
                    initial={{ opacity: 0, y: 10, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ ...SPRING.panel, delay: runout ? 1.85 : showdown ? 0.45 : 0 }}
                  >
                    <div className="flex flex-col items-center gap-1 rounded-xl border border-hairline-dark bg-paper/95 px-3.5 py-2 shadow-[0_10px_28px_rgb(23_21_14/0.16)]">
                      <Stamp rot={-4} tone="money" animate>
                        takes ${lastWinner.amount.toLocaleString("en-US")}
                      </Stamp>
                      <div className="whitespace-nowrap rounded-full px-1 font-mono text-[9.5px] uppercase text-ink-soft">
                        {lastWinner.name}
                        {lastWinner.text ? ` · ${lastWinner.text}` : ""}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* level toast — over the empty board zone at hand start */}
              <AnimatePresence>
                {levelToast ? (
                  <motion.div
                    key={levelToast}
                    className="absolute left-1/2 top-[248px] z-30 -translate-x-1/2"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <div className="rounded-full border border-ink/80 bg-ink px-4 py-1.5 font-mono text-[10px] font-semibold uppercase text-paper">
                      {levelToast}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
        )}

        {/* hand log (desktop) */}
        <aside className={cn("hidden w-[236px] shrink-0", !compact && "lg:block")}>
          <div className="mb-2 flex items-center justify-between">
            <span className="label">hand log</span>
            <span className="label">#{s.handNo}</span>
          </div>
          <div className="quiet-scroll max-h-[calc(100dvh-210px)] overflow-y-auto rounded-xl border border-hairline bg-paper px-3.5 py-2">
            <AnimatePresence initial={false}>
              {logNewestFirst.map((l) => (
                <motion.div
                  key={l.seq}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: DUR.fast }}
                  className={cn(
                    "border-b border-hairline py-1.5 font-mono text-[10.5px] leading-snug last:border-b-0",
                    l.kind === "hand" && "pt-2 font-semibold text-ink",
                    l.kind === "result" && "font-semibold text-ink",
                    l.kind === "info" && "text-carmine",
                    (l.kind === "action" || l.kind === "blind") && "text-ink-soft",
                    l.kind === "street" && "text-ink-soft",
                  )}
                >
                  {l.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------------ action bar */}
      {compact ? (
        <MobileBettingDock legal={awaitingHuman ? legal : null} currentBet={s.currentBet} playerBet={human.bet} pot={pot}
          status={settling ? "Saving session…" : cashOutQueued ? "Cash-out queued" : awaitingHuman ? "Your turn" : shuffling ? "Shuffling the deck" :
            s.phase === "betting" ? `${s.seats[s.toAct]?.name ?? "Table"} to act` : showdown ? "Showdown" : "Between hands"}
          seconds={shotClock >= 0 ? shotClock : undefined} onAction={humanAct}
          secondary={<>
            <span>{canCashOut ? cashOutQueued ? "Leaves after this hand" : "Cash-out unlocked" : `${CASH_OUT_MIN_HANDS - completedHands} hands to cash-out`}</span>
            {canCashOut && !settling && <TactileButton variant="paper" size="sm" className="h-11"
              onClick={() => cashOutQueued ? cancelCashOut() : void leaveTable()}>{cashOutQueued ? "Keep playing" : "Cash out"}</TactileButton>}
          </>} />
      ) : (
      <div className="sticky bottom-0 z-30 mt-auto bg-gradient-to-t from-canvas via-canvas to-transparent pb-3 pt-2">
        {awaitingHuman && legal ? (
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={SPRING.action}
            className="mx-auto w-full max-w-[640px] rounded-2xl border border-hairline-dark bg-paper p-3 shadow-[0_10px_30px_rgb(23_21_14/0.10)]"
          >
            {legal.canRaise ? (
              <div className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="quiet-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                  {presets.map((p) =>
                    p.hold ? (
                      <HoldToConfirm key={p.label} disabled={p.v > legal.maxRaiseTo} onConfirm={() => humanAct({ type: "raise", to: p.v })}>
                        all-in
                      </HoldToConfirm>
                    ) : (
                      <button
                        key={p.label}
                        onClick={() => setRaiseTo(Math.min(p.v, legal.maxRaiseTo))}
                        className="rounded-lg border border-hairline-dark bg-canvas/60 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase text-ink-soft transition-colors hover:border-ink hover:text-ink"
                      >
                        {p.label}
                      </button>
                    ),
                  )}
                </div>
                <div className="flex w-full items-center gap-2 sm:w-[190px]">
                  <input
                    type="range"
                    className="felt-range"
                    min={legal.minRaiseTo}
                    max={legal.maxRaiseTo}
                    step={5}
                    value={Math.min(raiseTo, legal.maxRaiseTo)}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                    aria-label="Raise amount"
                  />
                  <span className="tnum w-[54px] text-right font-mono text-[12px] font-semibold">
                    ${Math.min(raiseTo, legal.maxRaiseTo).toLocaleString("en-US")}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 [&>button]:px-1 sm:[&>button]:px-4">
              <TactileButton variant="paper" size="lg" onClick={() => humanAct({ type: "fold" })}>
                Fold
              </TactileButton>
              {legal.canCheck ? (
                <TactileButton variant="ink" size="lg" onClick={() => humanAct({ type: "check" })}>
                  Check
                </TactileButton>
              ) : (
                <TactileButton variant="ink" size="lg" onClick={() => humanAct({ type: "call" })}>
                  Call ${legal.callAmount.toLocaleString("en-US")}
                </TactileButton>
              )}
              {legal.canRaise ? (
                <TactileButton
                  variant="accent"
                  size="lg"
                  onClick={() => humanAct({ type: "raise", to: Math.min(raiseTo, legal.maxRaiseTo) })}
                >
                  {s.currentBet === 0 ? "Bet" : "Raise"} ${Math.min(raiseTo, legal.maxRaiseTo).toLocaleString("en-US")}
                </TactileButton>
              ) : (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-hairline font-mono text-[10px] uppercase text-ink-faint">
                  {legal.isRaiseLocked ? "call or fold" : "no raise"}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="mx-auto w-full max-w-[640px] rounded-2xl border border-hairline bg-paper px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[10px] uppercase text-ink-faint">
                    {shuffling
                      ? "shuffling the deck"
                      : folded && s.phase === "betting"
                        ? `folded — waiting on ${s.seats[s.toAct]?.name ?? "the table"}`
                        : s.phase === "betting"
                          ? `waiting on ${s.seats[s.toAct]?.name ?? "the table"}`
                          : showdown
                            ? "showdown"
                            : handEnd
                              ? "settling the pot"
                              : "dealing the next hand"}
                  </span>
                  {pot > 0 ? (
                    <span className="tnum shrink-0 font-mono text-[9px] text-ink-faint">
                      pot ${pot.toLocaleString("en-US")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <CashOutMeter
                    done={Math.min(completedHands, CASH_OUT_MIN_HANDS)}
                    min={CASH_OUT_MIN_HANDS}
                    unlocked={canCashOut}
                  />
                  <span className="font-mono text-[9px] uppercase text-ink-faint">
                    {busted
                      ? "out of chips — cash out any time"
                      : canCashOut
                        ? "cash-out unlocked"
                        : `${CASH_OUT_MIN_HANDS - completedHands} hand${CASH_OUT_MIN_HANDS - completedHands === 1 ? "" : "s"} to cash-out`}
                  </span>
                </div>
              </div>
              {!settling ? (
                <motion.div
                  key={cashOutNudge}
                  animate={cashOutNudge > 0 ? { x: [0, -4, 4, -3, 0] } : { x: 0 }}
                  transition={{ duration: DUR.base, ease: EASE.tap }}
                >
                  {cashOutQueued ? (
                    <button
                      onClick={cancelCashOut}
                      className="flex h-8 items-center gap-1.5 rounded-xl border border-ink bg-ink px-3 font-mono text-[10px] uppercase text-paper"
                      title="Stay in the hand and keep playing"
                    >
                      <X className="h-3 w-3" />
                      keep playing
                    </button>
                  ) : canCashOut ? (
                    <TactileButton variant="paper" size="sm" onClick={() => void leaveTable()}>
                      {waitingForBoundary ? "Cash out after hand" : `Cash out $${human.stack.toLocaleString("en-US")}`}
                    </TactileButton>
                  ) : (
                    <button
                      onClick={() => void leaveTable()}
                      aria-disabled="true"
                      className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-xl border border-hairline bg-canvas/60 px-3 font-mono text-[10px] uppercase text-ink-faint"
                      title={`The seat is yours for ${CASH_OUT_MIN_HANDS} hands. ${CASH_OUT_MIN_HANDS - completedHands} to go.`}
                    >
                      <Lock className="h-3 w-3" />
                      Cash out
                    </button>
                  )}
                </motion.div>
              ) : (
                <span className="font-mono text-[10px] uppercase text-ink-faint">settling…</span>
              )}
            </div>
            <div className="mt-2 border-t border-dashed border-ink/15 pt-1.5 font-mono text-[9px] uppercase text-ink-faint">
              {cashOutQueued
                ? "cash-out queued — the chips leave when this hand ends"
                : busted
                  ? "you are out of chips — cash out any time, no ten-hand wait"
                  : canCashOut && waitingForBoundary
                    ? "cash-out happens from the next hand, not mid-hand"
                    : canCashOut
                      ? "the table is yours — cash out whenever you like"
                      : "the seat is a commitment — ten hands, then the chips are yours"}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
