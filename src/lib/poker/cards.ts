// ---------------------------------------------------------------------------
// Felt — cards.ts : deck primitives
// ---------------------------------------------------------------------------

export type Suit = "s" | "h" | "d" | "c";

export interface Card {
  /** rank, 2..14 (14 = ace) */
  r: number;
  s: Suit;
  /** stable identity for animation keys, e.g. "As" */
  id: string;
}

export const SUITS: Suit[] = ["s", "h", "d", "c"];

export const RANK_CHARS: Record<number, string> = {
  14: "A", 13: "K", 12: "Q", 11: "J", 10: "T",
  9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2",
};

/** How the index prints on a real card — tens read "10", not "T". */
export const RANK_INDEX: Record<number, string> = {
  ...RANK_CHARS,
  10: "10",
};

export const RANK_WORDS: Record<number, string> = {
  14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten",
  9: "Nine", 8: "Eight", 7: "Seven", 6: "Six", 5: "Five", 4: "Four", 3: "Three", 2: "Two",
};

export const RANK_PLURAL: Record<number, string> = {
  14: "Aces", 13: "Kings", 12: "Queens", 11: "Jacks", 10: "Tens",
  9: "Nines", 8: "Eights", 7: "Sevens", 6: "Sixes", 5: "Fives", 4: "Fours", 3: "Threes", 2: "Deuces",
};

export function cardId(r: number, s: Suit): string {
  return `${RANK_CHARS[r]}${s}`;
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) {
      deck.push({ r, s, id: cardId(r, s) });
    }
  }
  return deck;
}

// --------------------------------------------------------------- RNG --------
// The shuffle is a cryptographic one, and it leaves a receipt.
//
//   1. 32 bytes come from the platform CSPRNG and become a seed.
//   2. ChaCha20 expands that seed into a 32-bit stream.
//   3. Fisher–Yates runs over the 52 cards, drawing each index with rejection
//      sampling — every one of the 52! orderings is exactly as likely as any
//      other (no modulo bias, no Math.random, no deck knowledge anywhere).
//   4. Before card one is dealt, SHA-256(seed + order) is published.
//   5. When the hand ends the seed is revealed, so the commit can be replayed
//      and checked. The dealer cannot change the deck after the fact.

import { randomSeedHex, uniformBelow, sha256Hex, streamFromSeedHex } from "./rng";

export interface ShuffledDeck {
  deck: Card[];
  /** the secret — revealed when the hand is over */
  seed: string;
  /** published before the deal; binds seed to the exact order */
  commit: string;
}

/** Deterministic shuffle of a fresh deck from a hex seed. */
export function deckFromSeed(seed: string): Card[] {
  const d = freshDeck();
  const stream = streamFromSeedHex(seed);
  for (let i = d.length - 1; i > 0; i--) {
    const j = uniformBelow(() => stream.nextU32(), i + 1);
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }
  return d;
}

/** The published commitment: SHA-256 over the seed and the resulting order. */
export function commitOf(seed: string, deck: Card[]): string {
  return sha256Hex(`${seed}|${deck.map((c) => c.id).join(" ")}`);
}

/** Shuffle a fresh deck and seal it. Called once per hand, never on demand. */
export function secureDeck(): ShuffledDeck {
  const seed = randomSeedHex();
  const deck = deckFromSeed(seed);
  return { deck, seed, commit: commitOf(seed, deck) };
}

/**
 * Re-derive the deck from a revealed seed and check it against the commit.
 * This is the whole audit: same seed in, same order out, hash matches.
 */
export function verifyDeck(seed: string, commit: string): { valid: boolean; deck: Card[] } {
  try {
    const deck = deckFromSeed(seed);
    return { valid: commitOf(seed, deck) === commit.toLowerCase(), deck };
  } catch {
    return { valid: false, deck: [] };
  }
}

/** Convenience for non-sealed uses (tests, previews). */
export function shuffled(): Card[] {
  return deckFromSeed(randomSeedHex());
}

export function cardLabel(c: Card): string {
  return `${RANK_INDEX[c.r]}${c.s === "s" ? "♠" : c.s === "h" ? "♥" : c.s === "d" ? "♦" : "♣"}`;
}

export function isRed(s: Suit): boolean {
  return s === "h" || s === "d";
}
