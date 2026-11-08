"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowUp, ArrowUpRight, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "./brand";
import { ACE_OF_SPADES_SRC, CARD_BACK_SRC, cardFaceSrc } from "./poker-assets";
import styles from "./room-footer.module.css";

const fan = [
  { src: CARD_BACK_SRC, x: "-0.86em", y: "0.12em", angle: -28 },
  { src: cardFaceSrc({ r: 12, s: "h", id: "Qh" }), x: "-0.36em", y: "-0.07em", angle: -13 },
  { src: cardFaceSrc({ r: 10, s: "s", id: "Ts" }), x: "0.16em", y: "-0.13em", angle: 4 },
  { src: ACE_OF_SPADES_SRC, x: "0.69em", y: "0.03em", angle: 21 },
];

const stack = { x: "0em", y: "0.1em", rotate: 0, scale: 0.9 };

export function RoomFooter({ atLiveLobby = false }: { atLiveLobby?: boolean }) {
  const artwork = useRef<HTMLDivElement>(null);
  const seen = useInView(artwork, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  const [gathering, setGathering] = useState(false);
  const spread = reduced || (seen && !gathering);

  useEffect(() => {
    if (!gathering) return;
    const timer = setTimeout(() => setGathering(false), 230);
    return () => clearTimeout(timer);
  }, [gathering]);

  return (
    <footer className={cn("elo-page", styles.outer)}>
      <div className={styles.panel}>
        <div className={styles.main}>
          <div className={styles.copy}>
            <p className={styles.kicker}><span aria-hidden /> The Elo poker room</p>
            <h2 className={styles.title}>See you at<br /><em>the table.</em></h2>
            <p className={styles.description}>Bring a friend, pull up a chair, and see what the next hand brings.</p>
            <Link href={atLiveLobby ? "/" : "/live"} className={styles.cta}>
              {atLiveLobby ? "Back to the lobby" : "Play with friends"} <ArrowUpRight size={16} aria-hidden />
            </Link>
          </div>
          <div className={styles.artwork} ref={artwork}>
            <div className={styles.rings} aria-hidden />
            <div className={styles.fan} aria-hidden>
              {fan.map(({ src, x, y, angle }, index) => {
                const ace = index === fan.length - 1;
                return (
                  <motion.div
                    key={src}
                    className={styles.card}
                    initial={false}
                    animate={spread ? { x, y, rotate: angle, scale: 1 } : stack}
                    transition={reduced ? { duration: 0 } : spread
                      ? { type: "spring", stiffness: 310, damping: 25, mass: 0.85, delay: index * 0.075 }
                      : { duration: 0.19, ease: "easeInOut" }}
                  >
                    {ace ? (
                      <motion.div
                        className={styles.flipper}
                        initial={false}
                        animate={{ rotateY: spread ? 0 : 180 }}
                        transition={reduced ? { duration: 0 } : { duration: 0.35, delay: spread ? 0.28 : 0, ease: "easeInOut" }}
                      >
                        <img src={src} alt="" draggable={false} loading="lazy" />
                        <img src={CARD_BACK_SRC} alt="" draggable={false} loading="lazy" className={styles.back} />
                      </motion.div>
                    ) : <img src={src} alt="" draggable={false} loading="lazy" />}
                  </motion.div>
                );
              })}
            </div>
            <button type="button" className={styles.shuffle} aria-disabled={gathering} onClick={() => { if (!gathering) setGathering(true); }}>
              <Shuffle size={14} aria-hidden /> Shuffle cards
            </button>
          </div>
        </div>
        <div className={styles.base}>
          <Link href="/" className={styles.wordmark} aria-label="Elo home"><Wordmark className="text-2xl" /></Link>
          <p className={styles.meta}>No-limit Hold’em <span aria-hidden>·</span> Play money</p>
          <button type="button" className={styles.top} onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" })}>
            Back to top <ArrowUp size={14} aria-hidden />
          </button>
        </div>
      </div>
    </footer>
  );
}
