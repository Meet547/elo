"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionStyle } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { pullDistance, ratingCurve, ratingIndex, ratingReading, ratingWindow, REFRESH_THRESHOLD, type GraphPoint } from "@/lib/rating-chart";
import styles from "./rating-chart.module.css";

export type { GraphPoint } from "@/lib/rating-chart";

const WINDOWS = [
  { label: "10 sessions", count: 10 },
  { label: "30 sessions", count: 30 },
  { label: "All", count: null },
] as const;
const HEIGHT = 160;
const fmt = (value: number) => value.toLocaleString("en-US");
const signed = (value: number) => `${value < 0 ? "−" : "+"}${fmt(Math.abs(value))}`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dateTime = (at: string) => new Date(at).toLocaleString("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

type Phase = "idle" | "pull" | "armed" | "refreshing";
type Grab = {
  id: number;
  x: number;
  y: number;
  scale: number;
  plot: boolean;
  mode: "pending" | "pull" | "scrub";
  armed: boolean;
};

export function RatingGraph({
  points, currentRating, onRefresh, loading = false, emptyAction, className,
}: {
  points: GraphPoint[];
  currentRating: number;
  onRefresh: () => Promise<void>;
  loading?: boolean;
  emptyAction?: ReactNode;
  className?: string;
}) {
  const [windowIndex, setWindowIndex] = useState(2);
  const [scrub, setScrub] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const grab = useRef<Grab | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const returning = useRef<ReturnType<typeof animate> | null>(null);
  const reduced = useReducedMotion();
  const filterId = `rating-goo-${useId().replace(/:/g, "")}`;
  const helpId = useId();
  const offset = useMotionValue(0);
  const growth = useTransform(offset, value => Math.max(-6, value));
  const wellHeight = useTransform(offset, value => Math.max(0, value));
  const spread = useTransform(offset, value => `${20 - Math.min(1, Math.max(0, value) / REFRESH_THRESHOLD) * 17.5}px`);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      returning.current?.stop();
    };
  }, []);

  const series = ratingWindow(points, WINDOWS[windowIndex].count);
  const reading = ratingReading(series, scrub);
  const curve = ratingCurve(series.map(point => point.value), HEIGHT);
  const selected = reading ? curve.points[reading.index] : null;
  const last = series.length - 1;
  const upward = !series.length || series[last].value >= series[0].value;
  const scrubbing = scrub !== null && Boolean(reading);
  const refreshing = phase === "refreshing";
  const sessionCount = Math.max(0, series.length - 1);

  function settle(target = 0) {
    returning.current?.stop();
    if (reduced) offset.set(target);
    else returning.current = animate(offset, target, { type: "spring", stiffness: 340, damping: 25, mass: 0.8 });
  }

  async function refresh() {
    if (busy.current || loading) return;
    busy.current = true;
    setScrub(null);
    setNotice("");
    setFailed(false);
    setPhase("refreshing");
    settle(REFRESH_THRESHOLD);
    try {
      // Start the request on release. The spring never delays the data.
      await onRefresh();
      if (mounted.current) setNotice("Ratings up to date.");
    } catch {
      if (mounted.current) {
        setFailed(true);
        setNotice("Couldn’t refresh ratings. Try again.");
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPhase("idle");
        settle();
      }
    }
  }

  function readAt(clientX: number) {
    if (!plot.current || !series.length || busy.current) return;
    const rect = plot.current.getBoundingClientRect();
    setScrub(ratingIndex(clientX, rect.left, rect.width, series.length));
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || busy.current || loading || grab.current) return;
    if ((event.target as Element).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inPlot = Boolean(plot.current?.contains(event.target as Node));
    grab.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      scale: rect.width / (event.currentTarget.offsetWidth || rect.width),
      plot: inPlot, mode: "pending", armed: false,
    };
    returning.current?.stop();
    if (inPlot) readAt(event.clientX);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const held = grab.current;
    if (!held || held.id !== event.pointerId) return;
    const dx = (event.clientX - held.x) / held.scale;
    const dy = (event.clientY - held.y) / held.scale;
    if (held.mode === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (!held.plot) { grab.current = null; settle(); return; }
        held.mode = "scrub";
      } else if (dy > 0) {
        held.mode = "pull";
        setScrub(null);
        setNotice("");
      } else {
        grab.current = null;
        settle();
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (held.mode === "scrub") {
      readAt(event.clientX);
      return;
    }
    const drawn = pullDistance(dy);
    // Follow the pointer directly; only the journey home is animated.
    offset.set(drawn);
    held.armed = drawn >= REFRESH_THRESHOLD;
    setPhase(held.armed ? "armed" : "pull");
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const held = grab.current;
    if (!held || held.id !== event.pointerId) return;
    grab.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && held.mode === "pull" && held.armed) void refresh();
    else {
      setPhase("idle");
      settle();
    }
    if (cancelled) setScrub(null);
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!reading || busy.current) return;
    const keys: Record<string, number> = {
      ArrowLeft: reading.index - 1, ArrowDown: reading.index - 1,
      ArrowRight: reading.index + 1, ArrowUp: reading.index + 1,
      Home: 0, End: last,
    };
    if (event.key === "Escape") { setScrub(null); return; }
    if (!(event.key in keys)) return;
    event.preventDefault();
    setScrub(Math.max(0, Math.min(last, keys[event.key])));
  }

  const status = phase === "armed" ? "Release to refresh" : phase === "pull" ? "Pull a little further"
    : refreshing || loading ? "Refreshing ratings…" : notice || "Drag the line to explore · Pull down to refresh";

  return (
    <motion.section className={cn("elo-panel", styles.card, className)} data-phase={phase} data-up={upward}
      aria-label="Rating history" aria-busy={loading || refreshing} style={{ paddingBottom: growth }}>
      <svg className={styles.filter} aria-hidden="true">
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
          </filter>
        </defs>
      </svg>
      <motion.div className={styles.well} style={{ height: wellHeight }} aria-hidden="true">
        <motion.div className={styles.goo} style={{ filter: `url(#${filterId})`, "--spread": refreshing ? "16px" : spread } as MotionStyle}>
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className={styles.drop} style={{ "--angle": `${index * 72}deg` } as CSSProperties} />
          ))}
        </motion.div>
      </motion.div>

      <motion.div className={styles.sheet} style={{ y: offset }}
        onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)}
        onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
        <div className={styles.pullHandle}>
          <div className={styles.heading}>
            <h2>Rating history</h2>
            <button type="button" className={styles.refresh} aria-label="Refresh rating history" disabled={loading || refreshing}
              onClick={() => void refresh()}><RefreshCw size={17} aria-hidden="true" /></button>
          </div>
          <div className={styles.value}>{fmt(reading?.point.value ?? currentRating)}<span>rating</span></div>
          <div className={styles.summary}>
            {reading ? <span className={styles.change} data-direction={reading.change > 0 ? "up" : reading.change < 0 ? "down" : "flat"}>
              {signed(reading.change)} pts <span>· {reading.percent < 0 ? "−" : "+"}{Math.abs(reading.percent).toFixed(1)}%</span>
            </span> : <span>Your starting rating</span>}
            <span className={styles.when}>{reading ? scrubbing ? `${reading.point.label ?? "Session"} · ${dateTime(reading.point.at)}`
              : `${sessionCount} session${sessionCount === 1 ? "" : "s"}` : "Play your first session"}</span>
          </div>
        </div>

        {reading && selected ? <>
          <div className={styles.plotFrame}>
            <div ref={plot} className={styles.plot} role="slider" tabIndex={0} aria-label="Explore rating history"
              aria-valuemin={0} aria-valuemax={Math.max(0, last)} aria-valuenow={reading.index}
              aria-valuetext={`${reading.point.label ?? "Session"}, ${dateTime(reading.point.at)}, rating ${fmt(reading.point.value)}, ${signed(reading.change)} points`}
              aria-describedby={helpId} data-scrubbing={scrubbing}
              onKeyDown={keyboard} onBlur={() => setScrub(null)}
              onPointerMove={event => { if (!grab.current && event.pointerType === "mouse") readAt(event.clientX); }}
              onPointerLeave={() => { if (!grab.current) setScrub(null); }}>
              <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                <path d={curve.path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {scrubbing && <span className={styles.guide} style={{ left: `${selected.x}%` }} />}
              <span className={styles.dot} style={{ left: `${selected.x}%`, top: `${selected.y / HEIGHT * 100}%` }} />
            </div>
          </div>
          <div className={styles.dates}><span>{day(series[0].at)}</span><span>{day(series[last].at)}</span></div>
          <div className={styles.windows} role="group" aria-label="Rating history range">
            <span className={styles.windowPill} style={{ transform: `translateX(${windowIndex * 100}%)` }} aria-hidden="true" />
            {WINDOWS.map((window, index) => <button key={window.label} type="button" aria-pressed={windowIndex === index}
              onClick={() => { setScrub(null); setWindowIndex(index); }}>{window.label}</button>)}
          </div>
          <p id={helpId} className="sr-only">Use the arrow keys to read each session. Home reads the first rating, End reads the latest. Escape returns to the latest rating.</p>
        </> : <div className={styles.empty}>
          <p>{loading ? "Loading your rating history…" : "Your rating story starts at the table."}</p>
          {!loading && emptyAction}
        </div>}
        <p className={styles.status} role="status" aria-live="polite" data-error={failed}>{status}</p>
      </motion.div>
    </motion.section>
  );
}
