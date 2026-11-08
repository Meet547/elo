"use client";

// ---------------------------------------------------------------------------
// error.tsx — the table stops, the room stays open.
//
// A thrown render must never leave a player staring at a blank felt: this
// surface keeps the brand, says what happened in one line, and offers the two
// moves that actually recover (retry the screen, or go back to the ladder).
// The error itself is logged once with the digest the server can correlate.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { Wordmark } from "@/components/felt/brand";
import { TactileButton } from "@/components/felt/kit";

export default function ErrorSurface({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[elo] render failed", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <Wordmark className="text-[26px]" />
      <div className="mt-8 w-full rounded-2xl border border-hairline bg-paper px-6 py-7 shadow-[0_2px_0_0_var(--color-hairline-dark)]">
        <span className="label">table interrupted</span>
        <h1 className="mt-2 font-display text-2xl leading-tight">The felt did not load.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          Nothing was settled while the screen was down — your rating only moves when a hand
          posts. Try the screen again, and if it keeps failing, reload the room.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-[10px] uppercase text-ink-faint">
            ref {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex gap-2.5">
          <TactileButton variant="ink" size="lg" className="flex-1" onClick={reset}>
            Try again
          </TactileButton>
          <TactileButton
            variant="paper"
            size="lg"
            className="flex-1"
            onClick={() => {
              // A hard reload recovers a failed client bundle as well as the route.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = "/";
            }}
          >
            Reload room
          </TactileButton>
        </div>
      </div>
      <p className="mt-6 font-mono text-[9px] uppercase text-ink-faint">
        Elo · play money, real ratings
      </p>
    </div>
  );
}
