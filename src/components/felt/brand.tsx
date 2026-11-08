"use client";

import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ACE_OF_SPADES_SRC } from "./poker-assets";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-[0.32em] font-semibold leading-none ",
        className,
      )}
    >
      <img
        src={ACE_OF_SPADES_SRC}
        alt=""
        draggable={false}
        className="aspect-[5/7] w-[0.68em] shrink-0 rotate-[-10deg] drop-shadow-[0_1px_1px_rgb(23_21_14/0.2)]"
      />
      {SITE_NAME.toLowerCase()}
    </span>
  );
}
