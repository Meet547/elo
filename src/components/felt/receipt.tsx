"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Check, House, LoaderCircle } from "lucide-react";
import styles from "./receipt.module.css";

const number = (value: number) => value.toLocaleString("en-US");
const chips = (value: number) => `$${number(value)}`;
const signed = (value: number, asChips = false) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${asChips ? "$" : ""}${number(Math.abs(value))}`;

// Advance the paper in short bursts, pausing between printed lines.
const feed = ["-100%", "-91%", "-91%", "-81%", "-81%", "-70%", "-70%", "-58%", "-58%", "-45%", "-45%", "-32%", "-32%", "-20%", "-20%", "-10%", "-10%", "-3%", "-3%", "0%"];
const feedTimes = [0, .075, .105, .18, .21, .285, .315, .39, .42, .495, .525, .6, .63, .705, .735, .81, .84, .915, .945, 1];
const teeth = Array.from({ length: 80 }, (_, index) => `${100 - (index + 1) * 1.25}% ${index % 2 === 0 ? "100%" : "calc(100% - 5px)"}`).join(", ");
const paperEdge = `polygon(0 0, 100% 0, 100% calc(100% - 5px), ${teeth})`;

interface ReceiptStanding {
  name: string;
  place: number;
  amount: number;
  isMe: boolean;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface ReceiptProps {
  mode: "practice" | "ranked" | "private";
  reference: string;
  player: string;
  seat: number;
  seats: number;
  hands: number;
  finalStack: number;
  net: number;
  place: number;
  biggestPot?: number;
  bestHand?: string;
  fieldAvg?: number;
  ratingBefore: number;
  ratingAfter: number;
  rated?: boolean;
  rankBefore?: number;
  rankAfter?: number;
  settledAt?: Date;
  standings?: ReceiptStanding[];
  onHome?: () => void;
  actions: ReactNode;
}

function Row({ label, children, emphasis = false }: { label: ReactNode; children: ReactNode; emphasis?: boolean }) {
  return <div className={`${styles.row} ${emphasis ? styles.emphasis : ""}`}><dt>{label}</dt><dd>{children}</dd></div>;
}

function Rating({ before, after, ready }: { before: number; after: number; ready: boolean }) {
  const reduceMotion = useReducedMotion();
  const value = useMotionValue(before);
  const display = useTransform(value, (latest) => number(Math.round(latest)));
  useEffect(() => {
    if (!ready) return;
    const control = animate(value, after, { duration: reduceMotion ? 0 : .65, ease: [.23, 1, .32, 1] });
    return () => control.stop();
  }, [after, ready, reduceMotion, value]);
  return <span aria-label={number(after)}><motion.span aria-hidden>{display}</motion.span></span>;
}

function Barcode({ reference }: { reference: string }) {
  // Decorative only; the real, readable table or match reference is below it.
  const bars = Array.from({ length: 62 }, (_, index) => {
    const char = reference.charCodeAt(index % reference.length) || 0;
    return <rect key={index} x={index * 4 + 1} y="0" width={1 + (char + index) % 3} height="56" />;
  });
  return <div className={styles.barcode}><svg viewBox="0 0 250 56" aria-hidden>{bars}</svg><span>{reference}</span></div>;
}

export function Receipt({
  mode, reference, player, seat, seats, hands, finalStack, net, place, biggestPot, bestHand, fieldAvg,
  ratingBefore, ratingAfter, rated = mode === "ranked", rankBefore, rankAfter, settledAt, standings,
  onHome, actions,
}: ReceiptProps) {
  const reduceMotion = useReducedMotion();
  const [printed, setPrinted] = useState(false);
  const complete = printed || Boolean(reduceMotion);
  const ranked = mode === "ranked";
  const delta = ratingAfter - ratingBefore;
  const title = ranked ? "Ranked match" : "Cash out";
  const subtitle = ranked ? `${hands} hands · Head-to-head` : mode === "private" ? "Private table" : "Practice session";
  const finish = place === 0 ? "Draw" : `${place}${place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th"} of ${seats}`;
  const status = complete ? ranked ? "Match complete" : "Cash out complete" : "Printing your receipt";

  return (
    <main className={styles.page}>
      <section className={styles.printer} aria-label="Cash-out receipt printer" data-stage={complete ? "complete" : "printing"}>
        <div className={styles.machine}>
          <header className={styles.header}>
            <span className={styles.machineMark} aria-label="Elo">elo</span>
            {onHome ? <button type="button" onClick={onHome} className={styles.home}><House aria-hidden size={23} fill="currentColor" /> Home</button>
              : <Link href="/" className={styles.home}><House aria-hidden size={23} fill="currentColor" /> Home</Link>}
          </header>
          <div className={styles.screen}>
            <div className={styles.summary}>
              <div><h1>{title}</h1><p>{subtitle}</p></div>
              <div className={styles.screenTotal}><span>{ranked ? "Match total" : "Final stack"}</span><strong>{ranked ? signed(net, true) : chips(finalStack)}</strong></div>
            </div>
            <div className={styles.status} role="status" aria-live="polite">
              <AnimatePresence initial={false} mode="wait">
                <motion.span key={complete ? "complete" : "printing"} className={complete ? styles.check : styles.loading}
                  initial={reduceMotion ? false : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: .16 }}>
                  {complete ? <Check size={18} strokeWidth={3} aria-hidden /> : <LoaderCircle size={26} aria-hidden />}
                </motion.span>
              </AnimatePresence>
              <span>{status}</span>
            </div>
          </div>
          <div className={styles.slot} aria-hidden />
        </div>

        <div className={styles.output}>
          <div className={styles.slotShadow} aria-hidden />
          <motion.div className={styles.feed} initial={reduceMotion ? false : { y: "-100%" }}
            animate={{ y: reduceMotion ? "0%" : feed }}
            transition={{ duration: reduceMotion ? 0 : 1.75, delay: reduceMotion ? 0 : .25, ease: "linear", times: reduceMotion ? undefined : feedTimes }}
            onAnimationComplete={() => setPrinted(true)}>
            <article className={styles.paper} style={{ clipPath: paperEdge }} aria-label={`${title} receipt`} aria-hidden={!complete}>
              <div className={styles.paperBrand}><span aria-label="Elo">elo</span></div>
              <div className={styles.rule} />
              <div className={styles.item}>
                <div><h2>{ranked ? "RANKED HOLD’EM" : mode === "private" ? "PRIVATE HOLD’EM" : "PRACTICE HOLD’EM"}</h2><p>{hands} {hands === 1 ? "hand" : "hands"} played · {finish}</p></div>
                <strong>{signed(net, true)}</strong>
              </div>
              <div className={styles.rule} />
              <dl>
                {!ranked && <Row label="Buy-in">{chips(1500)}</Row>}
                <Row label={ranked ? "Final hand stack" : "Final stack"}>{chips(finalStack)}</Row>
                <Row label={ranked ? "Total profit" : "Net result"}>{signed(net, true)}</Row>
                {typeof biggestPot === "number" && <Row label="Biggest pot">{chips(biggestPot)}</Row>}
                {bestHand && <Row label="Best hand">{bestHand}</Row>}
                {typeof fieldAvg === "number" && <Row label="Field rating">{number(fieldAvg)}</Row>}
              </dl>
              <div className={styles.rule} />
              <dl>
                <Row label="Previous rating">{number(ratingBefore)}</Row>
                <Row label="Rating change"><span className={rated && delta > 0 ? styles.gain : rated && delta < 0 ? styles.loss : undefined}>{rated ? signed(delta) : "Unchanged"}</span></Row>
                <Row label="NEW RATING" emphasis><Rating before={ratingBefore} after={ratingAfter} ready={complete} /></Row>
                {!!rankBefore && !!rankAfter && <Row label="Ladder position">#{number(rankBefore)} → #{number(rankAfter)}</Row>}
              </dl>
              <p className={styles.ratingNote}>{rated ? "Your next match uses this rating." : `${mode === "practice" ? "Practice" : "Private"} games do not affect your rating.`}</p>
              {standings && standings.length > 0 && <>
                <div className={styles.rule} />
                <h2 className={styles.standingsTitle}>FINAL STANDINGS</h2>
                <ol className={styles.standings} aria-label="Final standings">{standings.map((entry, index) => <li key={index}>
                  <div><span>{entry.place === 0 ? "Draw" : `${entry.place}.`} {entry.name}{entry.isMe ? " · You" : ""}</span><strong>{ranked ? signed(entry.amount, true) : chips(entry.amount)}</strong></div>
                  {typeof entry.ratingBefore === "number" && typeof entry.ratingAfter === "number" && <p>{number(entry.ratingBefore)} → {number(entry.ratingAfter)} <span>({signed(entry.ratingAfter - entry.ratingBefore)})</span></p>}
                </li>)}</ol>
              </>}
              <div className={styles.rule} />
              <dl className={styles.details}>
                <Row label="Player">{player}</Row>
                <Row label="Seat">{seat} of {seats}</Row>
                <Row label={ranked ? "Match" : "Table"}>{reference}</Row>
                {settledAt && <Row label="Date">{settledAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} · {settledAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</Row>}
              </dl>
              <Barcode reference={reference} />
              <p className={styles.finePrint}>PLAY CHIPS · NO CASH VALUE</p>
            </article>
          </motion.div>
        </div>
        <div className={styles.actions}>{actions}</div>
      </section>
    </main>
  );
}
