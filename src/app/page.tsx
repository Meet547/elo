"use client";

import { useFelt } from "@/store/game";
import { Onboard } from "@/components/views/Onboard";
import { Lobby } from "@/components/views/Lobby";
import { TableView } from "@/components/views/TableView";
import { Settlement } from "@/components/views/Settlement";
import { ProfileView } from "@/components/views/Profile";
import { Shell } from "@/components/views/Shell";
import { Wordmark } from "@/components/felt/brand";
import { primeAudio } from "@/lib/felt/sound";
import { useEffect } from "react";

export default function Page() {
  const { view, booting, boot } = useFelt();

  useEffect(() => {
    if (!useFelt.getState().profile) void boot();
  }, [boot]);

  // Browsers hold an AudioContext suspended until a real gesture. Wake it on
  // the first interaction so the opening riffle is heard, not swallowed.
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Wordmark className="text-[22px] text-ink" />
      </div>
    );
  }

  // The view swap is driven by the store, and the entrance is a CSS animation:
  // navigation must never wait on a JS frame loop. An exit animation that
  // stalls (a tab that stops painting, a device under load) used to hold the
  // next screen hostage; the keyed wrapper replays `view-in` on every change
  // and respects prefers-reduced-motion.
  return (
    <div key={view} className="view-in">
      {view === "onboard" ? <Onboard /> : null}
      {view === "settle" ? <Settlement /> : null}
      {view === "lobby" ? (
        <Shell>
          <Lobby />
        </Shell>
      ) : null}
      {view === "table" ? (
        <Shell>
          <TableView />
        </Shell>
      ) : null}
      {view === "profile" ? (
        <Shell>
          <ProfileView />
        </Shell>
      ) : null}
    </div>
  );
}
