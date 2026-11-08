"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { chipSrc, type ChipColor, type ChipView } from "./poker-assets";

interface ChipDenom {
  v: number;
  color: ChipColor;
}

const DENOMS: ChipDenom[] = [
  { v: 1000, color: "yellow" },
  { v: 500, color: "purple" },
  { v: 100, color: "black" },
  { v: 25, color: "green" },
  { v: 5, color: "red" },
  { v: 1, color: "white" },
];

/** Greedy breakdown, biggest clay first, full chips the player can hold. */
function chipsFor(amount: number): ChipDenom[] {
  const out: ChipDenom[] = [];
  let rest = Math.max(0, Math.round(amount));
  for (const d of DENOMS) {
    let n = Math.floor(rest / d.v);
    rest -= n * d.v;
    while (n-- > 0 && out.length < 26) out.push(d);
  }
  if (rest > 0 && out.length === 0) out.push(DENOMS[DENOMS.length - 1]);
  return out.reverse(); // columns are drawn from bottom to top
}

const CHIP_ASPECT = { top: 1, tilt: 0.6, edge: 0.17 } as const;

function ChipArt({ color, view, size }: { color: ChipColor; view: ChipView; size: number }) {
  return (
    <img
      src={chipSrc(color, view)}
      style={{ width: size, height: size * CHIP_ASPECT[view] }}
      alt=""
      draggable={false}
      className="block max-w-none"
    />
  );
}

export function DealerButton({
  size,
  className,
  style,
}: {
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn("relative inline-grid place-items-center font-mono font-bold text-[#232035] drop-shadow-[0_1px_2px_rgb(12_24_19/0.45)]", className)}
      style={{ fontSize: Math.round(size * 0.39), ...style }}
      role="img"
      aria-label="Dealer button"
    >
      <ChipArt color="white" view="top" size={size} />
      <span aria-hidden className="absolute leading-none">D</span>
    </span>
  );
}

// Match the visible thickness of the edge asset so each layer sits flush.
const STEP = 0.13;

function Column({ chips, size }: { chips: ChipDenom[]; size: number }) {
  const step = size * STEP;
  const height = size * CHIP_ASPECT.tilt + (chips.length - 1) * step;
  return (
    <span
      className="relative block drop-shadow-[0_2px_1px_rgb(12_24_19/0.4)]"
      style={{ width: size, height }}
      aria-hidden
    >
      {chips.map((d, i) => {
        const isTop = i === chips.length - 1;
        const jitter = ((i * 37) % 3 - 1) * size * 0.012;
        return (
          <span key={i} className="absolute left-0" style={{ bottom: i * step, translate: `${jitter}px` }}>
            <ChipArt color={d.color} view={isTop ? "tilt" : "edge"} size={size} />
          </span>
        );
      })}
    </span>
  );
}

export const ChipStack = memo(function ChipStack({
  amount,
  size = 20,
  max = 8,
  className,
}: {
  amount: number;
  size?: number;
  max?: number;
  className?: string;
}) {
  if (amount <= 0) return null;
  const chips = chipsFor(amount).slice(-max); // cap the height, keep big clay on top
  return (
    <span className={cn("relative inline-block", className)} role="img" aria-label={`${amount} in chips`}>
      <Column chips={chips} size={size} />
    </span>
  );
});

// --------------------------------------------------------------- cluster ----
// A pot: three sloppy columns, tallest in the middle, plus one loose chip
// knocked out in front. The arrange order is fixed so a rerender never
// reshuffles the pot.
export const ChipCluster = memo(function ChipCluster({
  amount,
  size = 19,
  maxPer = 6,
  maxCols = 3,
  className,
}: {
  amount: number;
  size?: number;
  maxPer?: number;
  maxCols?: number;
  className?: string;
}) {
  if (amount <= 0) return null;
  const chips = chipsFor(amount);
  const cols: ChipDenom[][] = [];
  let cur: ChipDenom[] = [];
  for (const c of chips) {
    cur.push(c);
    if (cur.length >= maxPer) {
      cols.push(cur);
      cur = [];
      if (cols.length === maxCols) break;
    }
  }
  if (cur.length && cols.length < maxCols) cols.push(cur);
  const order = cols.length === 3 ? [1, 0, 2] : cols.length === 2 ? [1, 0] : [0];
  const loose = chips.length > 1 ? chips[chips.length - 2] : null;

  return (
    <span className={cn("relative inline-flex items-end", className)} role="img" aria-label={`${amount} in chips`}>
      {order.map((ci, pos) => {
        const col = cols[ci];
        if (!col) return null;
        const rot = pos === 0 ? 0 : pos === 1 ? -3.2 : 3;
        return (
          <span
            key={ci}
            style={{
              transform: `rotate(${rot}deg)`,
              transformOrigin: "bottom center",
              marginRight: pos === order.length - 1 ? 0 : -size * 0.16,
              position: "relative",
              zIndex: pos === 0 ? 3 : 1,
            }}
          >
            <Column chips={col.slice(0, maxPer)} size={size} />
          </span>
        );
      })}
      {loose ? (
        <span
          className="absolute rotate-[-14deg] drop-shadow-[0_2px_1px_rgb(12_24_19/0.35)]"
          style={{ left: -size * 0.52, bottom: -size * 0.06, zIndex: 4 }}
        >
          <ChipArt color={loose.color} view="top" size={size * 0.72} />
        </span>
      ) : null}
    </span>
  );
});

// ----------------------------------------------------------------- money ----

export function Money({
  children,
  className,
  signed = false,
}: {
  children: number;
  className?: string;
  signed?: boolean;
}) {
  const s = signed ? (children > 0 ? "+" : children < 0 ? "−" : "") : "";
  return (
    <span className={cn("tnum", className)}>
      <span className="opacity-50">{s}$</span>
      {Math.abs(children).toLocaleString("en-US")}
    </span>
  );
}
