// ---------------------------------------------------------------------------
// Motion tokens.
//
// One vocabulary for the whole room, so nothing feels borrowed from a template:
//
//   travel   a thing moving between two places (cards, chips, the view swap)
//   arrival  a thing settling into place (pot pill, receipt, stamp)
//   tap      state feedback that must feel instant (button press, toggle)
//
// Durations are deliberately short. Poker is read, not watched: motion explains
// a change and then gets out of the way. Springs are only used where a physical
// object is landing, never for fades.
// ---------------------------------------------------------------------------

export const EASE = {
  travel: [0.45, 0, 0.1, 1] as const,
  arrival: [0.25, 0.8, 0.25, 1] as const,
  tap: [0.3, 0.75, 0.1, 1] as const,
} as const;

export const DUR = {
  tap: 0.11,
  fast: 0.18,
  base: 0.28,
  slow: 0.44,
  settle: 0.62,
  /** chips travelling across the felt to the winner */
  sweep: 1.05,
  /** the deck riffle between hands */
  shuffle: 1.35,
} as const;

/** Windows where a stutter is least visible: 120 BPM-ish, human-scale. */
export const STAGGER = {
  card: 0.075,
  seat: 0.045,
  line: 0.035,
} as const;

/** Momentum presets — named for what is landing, not how it is tuned. */
export const SPRING = {
  /** a card arriving from the deck */
  card: { type: "spring", stiffness: 480, damping: 32, mass: 0.9 },
  /** chips landing on a bet or in the pot */
  chip: { type: "spring", stiffness: 520, damping: 24 },
  /** a panel appearing in place */
  panel: { type: "spring", stiffness: 380, damping: 26 },
  /** a nameplate taking its turn */
  plate: { type: "spring", stiffness: 420, damping: 26 },
  /** a fanned hand settling against the felt */
  fan: { type: "spring", stiffness: 320, damping: 26 },
  /** ladder rows reordering */
  ladder: { type: "spring", stiffness: 340, damping: 34 },
  /** a sheet rising from the bottom edge */
  sheet: { type: "spring", stiffness: 380, damping: 36 },
  /** the action bar arriving under the thumb */
  action: { type: "spring", stiffness: 420, damping: 32 },
  /** anything settling into its final place */
  settle: { type: "spring", stiffness: 300, damping: 30 },
} as const;

/** Standard fade-and-settle used by panels that appear in place. */
export const arrive = {
  initial: { opacity: 0, y: 6, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.995 },
  transition: { duration: DUR.base, ease: EASE.arrival },
} as const;
