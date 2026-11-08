"use client";

// ---------------------------------------------------------------------------
// Felt kit — tactile primitives in the Kitchen style: shaped faces, firm
// edges, compressible depth. Numbers roll only the digits that changed.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { DUR, EASE } from "@/lib/motion";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// TactileButton
// ---------------------------------------------------------------------------

const buttonVariants = cva(
  cn(
    "tactile relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "font-mono uppercase rounded-xl border",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
    "disabled:pointer-events-none disabled:opacity-40",
  ),
  {
    variants: {
      variant: {
        ink: "bg-ink text-paper border-ink shadow-[0_3px_0_0_#000] hover:bg-[#26241b] active:shadow-[0_1px_0_0_#000]",
        paper:
          "bg-paper text-ink border-hairline-dark shadow-[0_3px_0_0_var(--color-hairline-dark)] hover:bg-[#faf8f2] active:shadow-[0_1px_0_0_var(--color-hairline-dark)]",
        accent:
          "bg-carmine text-paper border-carmine-deep shadow-[0_3px_0_0_var(--color-carmine-deep)] hover:bg-[#cd452b] active:shadow-[0_1px_0_0_var(--color-carmine-deep)]",
        ghost: "bg-transparent text-ink-soft border-transparent hover:bg-ink/[0.045] shadow-none",
      },
      size: {
        sm: "h-8 px-3 text-[10px]",
        md: "h-10 px-4 text-[11px]",
        lg: "h-12 px-6 text-[12px]",
      },
    },
    defaultVariants: { variant: "ink", size: "md" },
  },
);

export interface TactileButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function TactileButton({ className, variant, size, ...props }: TactileButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// RollingNumber — digits roll individually; unchanged digits stay put
// ---------------------------------------------------------------------------

function RollDigit({ d, dir }: { d: string; dir: number }) {
  return (
    <span className="relative inline-block overflow-hidden align-baseline" style={{ height: "1.05em" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={d}
          className="inline-block"
          initial={{ y: dir >= 0 ? "0.95em" : "-0.95em", opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: dir >= 0 ? "-0.95em" : "0.95em", opacity: 0 }}
          transition={{ duration: DUR.base, ease: EASE.travel }}
        >
          {d}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RollingNumber({
  value,
  className,
  signed = false,
  prefix,
}: {
  value: number;
  className?: string;
  signed?: boolean;
  prefix?: string;
}) {
  // track the previously rendered value with render-phase state adjustment
  const [prev, setPrev] = useState(value);
  if (prev !== value) setPrev(value);

  const text = signed
    ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US")}`
    : Math.abs(value).toLocaleString("en-US");
  const prevText = signed
    ? `${prev > 0 ? "+" : prev < 0 ? "−" : ""}${Math.abs(prev).toLocaleString("en-US")}`
    : Math.abs(prev).toLocaleString("en-US");

  const chars = text.split("");
  const prevChars = prevText.split("");

  return (
    <span className={cn("tnum inline-flex items-baseline", className)} aria-label={text}>
      {prefix ? <span className="opacity-60">{prefix}</span> : null}
      {chars.map((ch, i) => {
        const staticChar = /[^0-9]/.test(ch);
        const pch = prevChars[i];
        const dir = staticChar || pch === undefined ? 1 : Number(ch) - Number(pch) >= 0 ? 1 : -1;
        return staticChar ? (
          <span key={i}>{ch}</span>
        ) : pch === undefined || ch === pch ? (
          <span key={i}>{ch}</span>
        ) : (
          <RollDigit key={i} d={ch} dir={dir} />
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScrambleText — settles left to right through a glyph shuffle
// ---------------------------------------------------------------------------

const GLYPHS = "0123456789ABCDEFGHIKLMNOPRSTUVXY";

export function ScrambleText({
  value,
  className,
  format,
  duration = DUR.settle * 1000,
}: {
  value: number | string;
  className?: string;
  format?: (v: number) => string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const isNum = typeof value === "number";
  const target = isNum ? (format ? format(value as number) : String(value)) : String(value);
  const [text, setText] = useState(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    // all state updates happen inside the rAF callback (async, lint-safe)
    const start = performance.now();
    const chars = target.split("");
    const dur = reduce ? 0 : duration;
    const tick = (now: number) => {
      const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      if (p >= 1) {
        setText(target);
        return;
      }
      const settled = Math.floor(p * chars.length);
      setText(
        chars
          .map((c, i) => {
            if (i < settled || /[\s,$+−.,—·]/.test(c)) return c;
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join(""),
      );
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, duration, reduce]);

  return <span className={cn("tnum", className)}>{text}</span>;
}

// ---------------------------------------------------------------------------
// Stamp — rubber stamp with rough edges
// ---------------------------------------------------------------------------

export function Stamp({
  children,
  className,
  rot = -6,
  tone = "carmine",
  animate = false,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  rot?: number;
  tone?: "carmine" | "ink" | "money";
  animate?: boolean;
  delay?: number;
}) {
  const tones = {
    carmine: "border-carmine/70 text-carmine/85",
    ink: "border-ink/60 text-ink/80",
    money: "border-money/60 text-money/85",
  } as const;
  const style: React.CSSProperties = {
    ["--stamp-rot" as string]: `${rot}deg`,
    animationDelay: `${delay}ms`,
  };
  return (
    <span
      className={cn(
        "stamp-cut inline-flex items-center gap-1.5 rounded-[6px] border-2 px-3 py-1 font-mono text-[11px] font-semibold uppercase ",
        animate && "stamp-in",
        tones[tone],
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LiveDot
// ---------------------------------------------------------------------------

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-1.5 w-1.5", className)}>
      <span className="live-dot absolute inset-0 rounded-full bg-money" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// FadeList — a compact list with soft overflow fade
// ---------------------------------------------------------------------------

export function FadeList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("quiet-scroll relative overflow-y-auto", className)}>
      <div
        className="pointer-events-none sticky top-0 z-10 h-5 bg-gradient-to-b from-[var(--color-paper)] to-transparent"
        aria-hidden
      />
      {children}
      <div
        className="pointer-events-none sticky bottom-0 z-10 h-5 bg-gradient-to-t from-[var(--color-paper)] to-transparent"
        aria-hidden
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plate — the player nameplate used on seats, ladder and header
// ---------------------------------------------------------------------------

export function Plate({
  name,
  sub,
  right,
  className,
  dimmed,
  active,
}: {
  name: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  dimmed?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-3 rounded-xl border bg-paper px-3 py-2 transition-colors",
        dimmed && "opacity-45 saturate-50",
        active ? "border-ink/70 shadow-[0_2px_0_0_var(--color-hairline-dark)]" : "border-hairline",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium leading-tight">{name}</div>
        {sub ? <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{sub}</div> : null}
      </div>
      {right ? <div className="shrink-0 text-right">{right}</div> : null}
      {active ? (
        <span className="absolute -left-[5px] top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-carmine" />
      ) : null}
    </div>
  );
}
