"use client";

import { useId, type CSSProperties } from "react";
import { OTPInput } from "input-otp";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { ROOM_CODE_LENGTH } from "@/lib/room-code";
import styles from "./one-time-code.module.css";

/* Adapted from Bencho's MIT-licensed One-time code component.
   Source and licence: https://bencho.dev/licence

   SIX CELLS, ONE FIELD
   Six real inputs break paste, backspace and screen readers. So there is
   one invisible input over the row and the cells are drawn underneath it.
   Room codes include A–Z as well as digits, unlike the numeric OTP demo.

   THE MERGE IS THE GOO'S
   Only the backgrounds sit under blur + alpha threshold. Text stays crisp
   above them: filtering glyphs would eat their antialiased edges.

   The result comes from the room API. Filling the row is not verification. */
export function OneTimeCode({ value, onChange, status = "idle", id, describedBy }: {
  value: string;
  onChange: (value: string) => void;
  status?: "idle" | "checking" | "valid" | "invalid";
  id: string;
  describedBy?: string;
}) {
  // Each mount needs its own filter id; duplicate SVG ids collide.
  const filterId = `room-code-${useId().replace(/:/g, "")}`;
  const reduced = useReducedMotion();
  return <div className={styles.root} data-status={status}>
    <OTPInput id={id} value={value} maxLength={ROOM_CODE_LENGTH} inputMode="text" pattern="^[0-9a-zA-Z]*$"
      onChange={next => onChange(next.toUpperCase())} pasteTransformer={text => text.trim().toUpperCase()}
      autoComplete="off" autoCapitalize="characters" spellCheck={false} required
      aria-label="6-character room code" aria-describedby={describedBy} aria-invalid={status === "invalid"}
      readOnly={status === "checking" || status === "valid"} aria-busy={status === "checking"}
      pushPasswordManagerStrategy="none" data-1p-ignore data-lpignore="true" data-bwignore="true"
      containerClassName={styles.field}
      render={({ slots }) => <>
        <div className={styles.shapes} aria-hidden="true" style={{ filter: reduced ? undefined : `url(#${filterId})` }}>
          {slots.map((_, index) => <span className={styles.shape} key={index}
            style={{ "--index": index } as CSSProperties} />)}
          <span className={styles.capsule} />
        </div>
        <div className={styles.cells} aria-hidden="true">
          {slots.map((slot, index) => <span key={index} className={styles.cell} data-active={slot.isActive}>
            {slot.char && <motion.span key={slot.char} initial={reduced ? false : { y: 9, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 460, damping: 24 }}>{slot.char}</motion.span>}
            {slot.hasFakeCaret && <i className={styles.caret} />}
          </span>)}
        </div>
        <span className={styles.result} aria-hidden="true"><Check size={16} />Room found</span>
      </>} />
    {/* A defs-only SVG is otherwise an invisible 300×150 replaced element.
        Keep it out of flow so it never changes the input's measurements. */}
    <svg className={styles.defs} aria-hidden="true" focusable="false"><defs>
      <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="smear" />
        <feColorMatrix in="smear" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12" />
      </filter>
    </defs></svg>
  </div>;
}
