export interface ProfileStatistics {
  sessions: number;
  hands: number;
  firsts: number;
  potsWon: number;
  net: number;
  biggestPot: number;
  bestNet: number | null;
  worstNet: number | null;
  finishes: { place: number; count: number }[];
}

export interface RatingHistoryEvent { before: number; after: number; at: string; label: string }
