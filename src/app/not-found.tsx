import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/felt/brand";

export const metadata: Metadata = {
  title: "No such table",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <Wordmark className="text-[26px]" />
      <div className="mt-8 w-full rounded-2xl border border-hairline bg-paper px-6 py-7 shadow-[0_2px_0_0_var(--color-hairline-dark)]">
        <span className="label">no such table</span>
        <h1 className="mt-2 font-display text-2xl leading-tight">This seat was never dealt.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          The room has one felt and one ladder. Whatever you followed here, it is not on the
          floor.
        </p>
        <Link
          href="/"
          className="tactile mt-6 flex h-12 w-full items-center justify-center rounded-xl border border-ink bg-ink font-mono text-[12px] uppercase text-paper shadow-[0_3px_0_0_#000]"
        >
          Back to the ladder
        </Link>
      </div>
    </div>
  );
}
