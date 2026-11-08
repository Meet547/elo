"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BotAction, LegalActions } from "@/lib/poker/engine";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DealerButton } from "./chips";
import { TactileButton } from "./kit";

export function useCompactTable() {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const screen = window.matchMedia("(max-width: 767px), (max-height: 500px)");
    const update = () => setCompact(screen.matches);
    update();
    screen.addEventListener("change", update);
    return () => screen.removeEventListener("change", update);
  }, []);
  return compact;
}

export const chipsLabel = (amount: number) => "$" + amount.toLocaleString("en-US");

export function CompactSeat({
  name, stack, cards, detail, bet, active, muted, dealer, winner,
}: {
  name: string;
  stack: number;
  cards?: ReactNode;
  detail?: ReactNode;
  bet?: number;
  active?: boolean;
  muted?: boolean;
  dealer?: boolean;
  winner?: boolean;
}) {
  return (
    <div className={cn(
      "compact-seat min-w-0 rounded-lg border border-hairline bg-paper",
      active && "border-money bg-[#edf4eb] ring-1 ring-money",
      winner && "border-money",
      muted && "bg-canvas/50 text-ink-faint",
    )}>
      <div className={cn("relative flex w-[42px] shrink-0 items-center justify-center -space-x-2", muted && "opacity-55")}>
        {cards}
        {dealer && <DealerButton size={13} className="absolute -top-1 -left-0.5 z-10" />}
      </div>
      <div className="min-w-0 flex-1 leading-none">
        <p className="truncate text-xs font-semibold" title={name}>{name}</p>
        <div className="compact-seat-balance mt-1 flex min-w-0 items-baseline gap-1 text-[10px] leading-none">
          <span className="tnum shrink-0 font-mono font-semibold">{chipsLabel(stack)}</span>
          {!!bet ? <span className="tnum shrink-0 text-ink-soft" aria-label={`Bet ${chipsLabel(bet)}`}>· {chipsLabel(bet)}</span> : detail}
        </div>
      </div>
    </div>
  );
}

export function CompactPlayer({ name, stack, bet, dealer, cards }: {
  name: string;
  stack: number;
  bet?: number;
  dealer?: boolean;
  cards?: ReactNode;
}) {
  return (
    <div className="compact-player flex min-w-0 items-center justify-center gap-3 rounded-xl border border-hairline bg-paper px-3">
      <div className="w-[99px] shrink-0">{cards}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium" title={name}>{name}</span>
          <span className="label shrink-0 text-carmine-deep">You</span>
          {dealer && <DealerButton size={14} className="shrink-0" />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <span className="tnum font-mono text-sm font-semibold">{chipsLabel(stack)}</span>
          {!!bet && <span className="tnum whitespace-nowrap text-[11px] text-ink-soft">In for {chipsLabel(bet)}</span>}
        </div>
      </div>
    </div>
  );
}

export function MobileBettingDock({
  legal, currentBet, playerBet, pot, status, seconds, busy, onAction, secondary, error,
}: {
  legal: LegalActions | null;
  currentBet: number;
  playerBet: number;
  pot: number;
  status: string;
  seconds?: number;
  busy?: boolean;
  onAction: (action: BotAction) => void;
  secondary?: ReactNode;
  error?: string;
}) {
  return (
    <div className="compact-dock" aria-label="Table actions">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <p role="status" className={cn("min-w-0 truncate text-xs font-semibold", legal ? "text-money-deep" : "text-ink-soft")}>{status}</p>
        {legal && seconds !== undefined && (
          <span className={cn("tnum shrink-0 rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px] font-semibold", seconds <= 8 && "text-carmine-deep")} aria-label={`${seconds} seconds remaining`}>{seconds}s</span>
        )}
      </div>
      {error && <p role="alert" className="mb-1 line-clamp-2 text-xs text-carmine-deep">{error}</p>}
      {legal ? (
        <div className={cn("grid gap-1.5", legal.canRaise ? "grid-cols-3" : "grid-cols-2")}>
          <TactileButton variant="paper" className="h-11 min-w-0 px-1" disabled={busy} onClick={() => onAction({ type: "fold" })}>Fold</TactileButton>
          <TactileButton className="h-11 min-w-0 px-1" disabled={busy} onClick={() => onAction({ type: legal.canCheck ? "check" : "call" })}>
            {legal.canCheck ? "Check" : `Call ${chipsLabel(legal.callAmount)}`}
          </TactileButton>
          {legal.canRaise && (
            <RaiseSheet legal={legal} currentBet={currentBet} playerBet={playerBet} pot={pot} busy={busy} onRaise={(to) => onAction({ type: "raise", to })} />
          )}
        </div>
      ) : (
        <div className="flex min-h-10 items-center justify-between gap-2 text-[11px] text-ink-soft">
          {secondary ?? <span className="tnum">{pot > 0 ? `Pot ${chipsLabel(pot)}` : "Hold’em"}</span>}
        </div>
      )}
    </div>
  );
}

function RaiseSheet({ legal, currentBet, playerBet, pot, busy, onRaise }: {
  legal: LegalActions;
  currentBet: number;
  playerBet: number;
  pot: number;
  busy?: boolean;
  onRaise: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(legal.minRaiseTo);
  const { minRaiseTo: min, maxRaiseTo: max } = legal;
  const to = Math.max(min, Math.min(max, amount));
  const call = legal.callAmount;
  const preset = (fraction: number) => Math.max(min, Math.min(max, playerBet + call + Math.round((pot + call) * fraction)));
  const label = currentBet === 0 ? "Bet" : "Raise";
  return (
    <Dialog onOpenChange={(open) => { if (open) setAmount(min); }}>
      <DialogTrigger asChild>
        <TactileButton variant="accent" className="h-11 min-w-0 px-1" disabled={busy}>{label}</TactileButton>
      </DialogTrigger>
      <DialogContent className="compact-sheet bg-paper">
        <div>
          <DialogTitle className="font-display text-3xl">{label} amount</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-ink-soft">Choose the total to put in this street.</DialogDescription>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[["Min", min], ["½ pot", preset(0.5)], ["Pot", preset(1)], ["Max", max]].map(([name, value]) => (
            <TactileButton key={name} variant="paper" size="sm" className="h-11 px-1" onClick={() => setAmount(Number(value))}>{name}</TactileButton>
          ))}
        </div>
        <label className="block">
          <span className="flex items-center justify-between gap-2 text-sm">
            Total <output className="tnum font-mono font-semibold">{chipsLabel(to)}</output>
          </span>
          <input type="range" className="felt-range h-11" min={min} max={max} step={1} value={to} disabled={min === max}
            onChange={(event) => setAmount(Number(event.target.value))} aria-label="Raise to" aria-valuetext={chipsLabel(to)} />
          <span className="tnum flex justify-between font-mono text-[11px] text-ink-soft"><span>{chipsLabel(min)}</span><span>{chipsLabel(max)}</span></span>
        </label>
        <DialogClose asChild>
          <TactileButton variant="accent" size="lg" onClick={() => onRaise(to)} disabled={busy}>
            {to === max ? "Go all-in" : label} {chipsLabel(to)}
          </TactileButton>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
