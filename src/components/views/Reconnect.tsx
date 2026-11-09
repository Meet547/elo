"use client";

import { Wordmark } from "@/components/felt/brand";
import { TactileButton } from "@/components/felt/kit";
import { useFelt } from "@/store/game";

export function Reconnect() {
  const { bootError, boot } = useFelt();
  return (
    <main className="elo-page flex min-h-dvh max-w-xl flex-col justify-center gap-4">
      <Wordmark className="text-3xl" />
      <h1 className="font-display text-3xl">Reconnect to your seat</h1>
      <p role="alert">{bootError}</p>
      <TactileButton onClick={() => void boot()}>Retry connection</TactileButton>
    </main>
  );
}
