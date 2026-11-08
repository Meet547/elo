"use client";

// ---------------------------------------------------------------------------
// Felt — ShuffleFX. The deck riffles at the centre of the felt between hands:
// split, cascade, square up. Pure transform/opacity, ~1.35s.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DUR } from "@/lib/motion";
import { CARD_BACK_SRC } from "./poker-assets";

const N = 9; // cards in the visual deck

export function ShuffleFX({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div
      className={cn("pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2", className)}
      aria-hidden
    >
      {/* soft shadow that breathes with the shuffle */}
      <motion.div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: 150,
          height: 36,
          marginLeft: -75,
          marginTop: -10,
          background: "radial-gradient(closest-side, rgb(23 21 14 / 0.22), transparent)",
        }}
        animate={{ scaleX: [1, 1.55, 1.15, 1], opacity: [0.8, 0.4, 0.55, 0.85] }}
        transition={{ duration: DUR.shuffle, times: [0, 0.2, 0.78, 1], ease: "easeInOut" }}
      />

      {Array.from({ length: N }).map((_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 w-[59px] -mt-[41.3px] -ml-[29.5px]"
            style={{
              zIndex: N - i,
              translate: `0 ${-i * 0.8}px`,
            }}
            initial={{ x: 0, y: 0, rotate: 0 }}
            animate={{
              x: [0, side * 54, 0],
              y: [0, -5 - (i % 3) * 2, 0],
              rotate: [0, side * 11, side * 1.6],
            }}
            transition={{
              duration: DUR.shuffle,
              times: [0, 0.22, 0.78],
              ease: ["easeOut", "easeInOut"],
              delay: i * 0.026,
            }}
          >
            <img src={CARD_BACK_SRC} alt="" draggable={false} className="poker-card-art aspect-[5/7]" />
          </motion.div>
        );
      })}

      {/* square-up: the deck lifts and settles */}
      <motion.div
        className="absolute left-1/2 top-1/2 w-[59px] -mt-[41.3px] -ml-[29.5px] blur-[2px]"
        style={{ zIndex: N + 1 }}
        animate={{ scaleY: [1, 1, 0.9, 1], opacity: [0, 0, 0.35, 0] }}
        transition={{ duration: DUR.shuffle, times: [0, 0.8, 0.9, 1] }}
      >
        <img src={CARD_BACK_SRC} alt="" draggable={false} className="poker-card-art aspect-[5/7]" />
      </motion.div>
    </div>
  );
}
