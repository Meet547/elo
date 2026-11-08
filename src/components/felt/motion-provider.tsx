"use client";

// One place where the room tells Framer how much motion it may use. "user"
// follows the OS setting, so a player who has asked their machine for calm gets
// the reduced variants everywhere — not just in the components that remembered
// to call useReducedMotion().

import { MotionConfig } from "framer-motion";
import { DUR } from "@/lib/motion";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base }}>
      {children}
    </MotionConfig>
  );
}
