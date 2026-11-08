"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { RANK_WORDS, type Card } from "@/lib/poker/cards";
import { motion, useReducedMotion } from "framer-motion";
import { CARD_BACK_SRC, cardFaceSrc } from "./poker-assets";

const SUIT_NAMES: Record<Card["s"], string> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

export interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  /** CSS width; height follows the deck's 5:7 ratio. */
  width?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** entrance animation from the dealer spot */
  deal?: boolean;
  dealIndex?: number;
  /** px offset from the resting spot back to the deck — cards fly the real line */
  from?: { x: number; y: number };
  /** explicit deal delay in ms (overrides the dealIndex stagger) */
  dealDelay?: number;
  /** mount face-down and turn over once landed (community cards, reveals) */
  flip?: boolean;
  /** ms to wait after mounting before the flip starts */
  flipDelay?: number;
}

export const PlayingCard = memo(function PlayingCard({
  card,
  faceDown = false,
  width = 80,
  className,
  style,
  deal = false,
  dealIndex = 0,
  from,
  dealDelay,
  flip = false,
  flipDelay = 0,
}: PlayingCardProps) {
  const reduce = useReducedMotion();
  // cards that flip (community cards, showdown reveals) start face-down and
  // turn over once they've landed — flipDelay staggers the reveal
  const [turned, setTurned] = useState(false);
  useEffect(() => {
    if (!flip || reduce) return;
    const t = setTimeout(() => setTurned(true), flipDelay + (deal ? 320 : 60));
    return () => clearTimeout(t);
  }, [flip, flipDelay, deal, reduce]);
  const showingBack = faceDown || !card || (flip && !turned && !reduce);

  const inner = (
    <motion.div
      className="relative h-full w-full"
      style={{ transformStyle: "preserve-3d" }}
      initial={false}
      animate={{ rotateY: showingBack ? 180 : 0 }}
      transition={flip ? { duration: reduce ? 0 : DUR.slow, ease: EASE.travel } : { duration: 0 }}
    >
      {card && !faceDown ? (
        <img
          src={cardFaceSrc(card)}
          alt={`${RANK_WORDS[card.r]} of ${SUIT_NAMES[card.s]}`}
          aria-hidden={showingBack || undefined}
          draggable={false}
          className="poker-card-art absolute inset-0"
          style={{ backfaceVisibility: "hidden" }}
        />
      ) : null}
      <img
        src={CARD_BACK_SRC}
        alt=""
        draggable={false}
        className="poker-card-art absolute inset-0"
        style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
      />
    </motion.div>
  );

  const boxStyle: React.CSSProperties = {
    width,
    aspectRatio: "5 / 7",
    perspective: 900,
    ...style,
  };

  // the flight: a spring from the deck with a soft rotation settle
  const rot0 = !from ? 0 : from.x > 4 ? -11 : from.x < -4 ? 11 : from.y > 0 ? -8 : 8;

  if (!deal || reduce) {
    return (
      <div className={cn("relative shrink-0 select-none", className)} style={boxStyle} aria-hidden={faceDown || undefined}>
        {inner}
      </div>
    );
  }
  return (
    <motion.div
      className={cn("relative shrink-0 select-none", className)}
      style={boxStyle}
      initial={{ x: from?.x ?? 0, y: from?.y ?? -140, rotate: rot0, opacity: 0, scale: 0.96 }}
      animate={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
      transition={{
        delay: (dealDelay ?? dealIndex * 80) / 1000,
        ...SPRING.card,
        opacity: { duration: DUR.tap, delay: (dealDelay ?? dealIndex * 80) / 1000 },
      }}
      aria-hidden={faceDown || undefined}
    >
      {inner}
    </motion.div>
  );
});

/** Debossed empty slot for the board. */
export function CardSlot({ width = 80 }: { width?: number | string }) {
  return (
    <div
      className="poker-card-slot shrink-0"
      style={{ width, aspectRatio: "5 / 7" }}
      aria-hidden
    />
  );
}

/** A fanned two-card hand. */
export function FanHand({
  cards,
  width = 99,
  reveal = true,
  className,
  from,
  dealDelays,
}: {
  cards: Card[];
  width?: number;
  reveal?: boolean;
  className?: string;
  /** deal origin for the whole hand */
  from?: { x: number; y: number };
  /** per-card deal delays (ms); falls back to index stagger */
  dealDelays?: number[];
}) {
  return (
    <div className={cn("flex items-end justify-center", className)} style={{ height: Math.round(width * 1.4) + 10 }}>
      {cards.map((c, i) => {
        const mid = (cards.length - 1) / 2;
        const off = i - mid;
        return (
          <motion.div
            key={c.id}
            className="origin-bottom"
            initial={false}
            animate={{
              rotate: off * 6,
              y: Math.abs(off) * 4,
              x: off * (width * 0.05),
            }}
            whileHover={{ rotate: 0, y: -9, scale: 1.04, zIndex: 5 }}
            transition={SPRING.fan}
            style={{
              zIndex: i,
              marginLeft: i === 0 ? 0 : -width * 0.4,
            }}
          >
            <PlayingCard
              card={c}
              width={width}
              faceDown={!reveal}
              deal
              dealIndex={i}
              dealDelay={dealDelays?.[i]}
              from={from}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
