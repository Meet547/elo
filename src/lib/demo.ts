"use client";

// ---------------------------------------------------------------------------
// Demo mode — the prototype's browser-side ladder.
//
// Vercel functions have no shared writable disk, and this app's prototype has
// no external database. Rather than a backend that silently forgets players
// between routes, the deployed prototype runs entirely in the browser: the
// house roster seeds the ladder, your sessions are rated with the same Glicko-2
// maths the server uses, and everything is kept in localStorage.
//
// The bots at the table are unchanged — they already live in the client poker
// engine. This file only stands in for the small amount of server state around
// them: who you are, the ladder, the wire and your session ledger.
// ---------------------------------------------------------------------------

import { ROSTER } from "@/lib/poker/ai";
import {
  START_RATING,
  START_RD,
  START_VOLATILITY,
  applySession,
} from "@/lib/rating";
import type { LadderRow, Profile, SessionRow, WireRow } from "@/store/game";

const PROFILE_KEY = "felt_demo_profile_v1";
const LADDER_KEY = "felt_demo_ladder_v1";
const SESSIONS_KEY = "felt_demo_sessions_v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled — the table still runs, it just forgets between reloads
  }
}

export function loadLocalProfile(): Profile | null {
  const stored = read<Profile | null>(PROFILE_KEY, null);
  return stored && typeof stored.id === "string" && typeof stored.name === "string" ? stored : null;
}

export function saveLocalProfile(profile: Profile) {
  write(PROFILE_KEY, profile);
}

export function loadLocalSessions(): SessionRow[] {
  const stored = read<SessionRow[]>(SESSIONS_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function saveLocalSessions(sessions: SessionRow[]) {
  write(SESSIONS_KEY, sessions.slice(0, 60));
}

/** A brand-new seat, identical in shape to the one the API would return. */
export function createLocalProfile(name: string): Profile {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `local_${crypto.randomUUID()}`
      : `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    name,
    rating: START_RATING,
    rd: START_RD,
    volatility: START_VOLATILITY,
    rated: 0,
    peak: START_RATING,
    hands: 0,
    cashes: 0,
    netChips: 0,
    biggestPot: 0,
    streak: 0,
  };
}

function rosterRow(slug: string, name: string, rating: number, hands: number, cashes: number): LadderRow {
  return {
    id: `rival_${slug}`,
    isSimulated: true,
    provenance: "SIMULATED",
    name,
    rating,
    rd: 70,
    rated: 120,
    volatility: 0.06,
    peak: rating + 60,
    hands,
    cashes,
    streak: 0,
    isMe: false,
    rank: 0,
  };
}

function syncRoster(stored: LadderRow[]): LadderRow[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  return ROSTER.map((bot) => {
    const existing = byId.get(`rival_${bot.slug}`);
    return existing
      ? { ...existing, name: bot.name, isSimulated: true, provenance: "SIMULATED" }
      : rosterRow(bot.slug, bot.name, bot.rating, bot.hands, bot.cashes);
  });
}

function rank(rows: LadderRow[]): LadderRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.rating - a.rating || b.hands - a.hands || a.name.localeCompare(b.name),
  );
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

function meRow(profile: Profile): LadderRow {
  return {
    id: profile.id,
    isSimulated: false,
    provenance: "REAL",
    name: profile.name,
    rating: profile.rating,
    rd: profile.rd,
    rated: profile.rated,
    volatility: profile.volatility ?? START_VOLATILITY,
    peak: profile.peak,
    hands: profile.hands,
    cashes: profile.cashes,
    streak: profile.streak,
    isMe: true,
    rank: 0,
  };
}

/** The ladder as this browser last saw it, with the house roster guaranteed. */
export function buildLocalLadder(profile: Profile | null): LadderRow[] {
  const stored = read<LadderRow[]>(LADDER_KEY, []);
  const rows = syncRoster(Array.isArray(stored) ? stored : []).filter((row) => !row.isMe);
  if (profile) rows.push(meRow(profile));
  return rank(rows);
}

export function saveLocalLadder(ladder: LadderRow[]) {
  write(LADDER_KEY, ladder);
}

export function localWire(sessions: SessionRow[], profile: Profile | null): WireRow[] {
  if (!profile) return [];
  return sessions.slice(0, 14).map((s) => ({
    id: s.id,
    name: profile.name,
    place: s.place,
    hands: s.hands,
    net: s.net,
    seats: s.seats,
    ratingBefore: s.ratingBefore,
    ratingAfter: s.ratingAfter,
    at: s.createdAt,
    provenance: "UNRANKED",
  }));
}

export interface LocalSettleInput {
  profile: Profile;
  ladder: LadderRow[];
  opponents: { id: string; rating: number }[];
  hands: number;
  finalStack: number;
  place: number;
  seats: number;
  biggestPot: number;
  potsWon: number;
  bestHand?: string | null;
  exit?: string | null;
  places: number[];
  stacks: number[];
}

export interface LocalSettleResult {
  profile: Profile;
  ladder: LadderRow[];
  sessions: SessionRow[];
  wire: WireRow[];
  result: {
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    peak: number;
    rankBefore: number;
    rankAfter: number;
    rd: number;
    rated: number;
    provisional: boolean;
    expected: number;
    fieldAvg: number;
  };
}

/**
 * Rate a six-max session locally: the same simultaneous Glicko-2 update, the
 * same exposure cap, and the same ladder movement the server would apply.
 */
export function settleLocally(input: LocalSettleInput): LocalSettleResult {
  const { profile, ladder, opponents, place, hands } = input;
  const byId = new Map(ladder.map((row) => [row.id, row]));

  const field = opponents.map((o, i) => {
    const row = byId.get(o.id);
    return {
      id: o.id,
      name: row?.name ?? o.id,
      rating: o.rating,
      rd: row?.rd ?? 70,
      volatility: row?.volatility ?? START_VOLATILITY,
      rated: row?.rated ?? 120,
      place: input.places[i] ?? i + 1,
      finalStack: input.stacks[i] ?? 0,
    };
  });

  const ratingBefore = profile.rating;
  const rankBefore =
    ladder.filter((row) => !row.isMe && row.rating > ratingBefore).length + 1;

  const mine = applySession(
    {
      rating: profile.rating,
      rd: profile.rd,
      volatility: profile.volatility ?? START_VOLATILITY,
      rated: profile.rated,
    },
    field.map((f) => ({ rating: f.rating, rd: f.rd, place: f.place })),
    place,
  );

  const ratingAfter = mine.rating;
  const delta = ratingAfter - ratingBefore;
  const peak = Math.max(profile.peak, ratingAfter);
  const streak =
    delta > 0 ? Math.max(0, profile.streak) + 1 : delta < 0 ? Math.min(0, profile.streak) - 1 : profile.streak;
  const net = input.finalStack - 1500;

  // every rival is rated from the same pre-session snapshot
  const rivalNext = new Map<string, ReturnType<typeof applySession>>();
  for (const f of field) {
    const theirField = [
      { rating: ratingBefore, rd: profile.rd, place },
      ...field
        .filter((x) => x.id !== f.id)
        .map((x) => ({ rating: x.rating, rd: x.rd, place: x.place })),
    ];
    rivalNext.set(
      f.id,
      applySession(
        { rating: f.rating, rd: f.rd, volatility: f.volatility, rated: f.rated },
        theirField,
        f.place,
      ),
    );
  }

  const rows = ladder
    .filter((row) => !row.isMe)
    .map((row) => {
      const next = rivalNext.get(row.id);
      const f = field.find((x) => x.id === row.id);
      if (!next || !f) return row;
      return {
        ...row,
        rating: next.rating,
        rd: next.rd,
        volatility: next.volatility,
        rated: next.rated,
        peak: Math.max(row.peak, next.rating),
        hands: row.hands + hands,
        cashes: row.cashes + (f.place === 1 ? 1 : 0),
      };
    });

  rows.push({
    ...meRow({ ...profile, rating: ratingAfter, rd: mine.rd, rated: mine.rated, peak, streak }),
    hands: profile.hands + hands,
    cashes: profile.cashes + (place === 1 ? 1 : 0),
  });
  const ranked = rank(rows);
  const rankAfter = ranked.find((row) => row.isMe)?.rank ?? 0;

  const sessions: SessionRow[] = [
    {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      hands,
      net,
      place,
      seats: input.seats,
      ratingBefore,
      ratingAfter,
      biggestPot: input.biggestPot,
      potsWon: input.potsWon,
      bestHand: input.bestHand ?? null,
      exit: input.exit ?? null,
      createdAt: new Date().toISOString(),
    },
    ...loadLocalSessions(),
  ].slice(0, 60);

  const nextProfile: Profile = {
    ...profile,
    rating: ratingAfter,
    rd: mine.rd,
    volatility: mine.volatility,
    rated: mine.rated,
    peak,
    hands: profile.hands + hands,
    cashes: profile.cashes + (place === 1 ? 1 : 0),
    netChips: profile.netChips + net,
    biggestPot: Math.max(profile.biggestPot, input.biggestPot),
    streak,
  };

  saveLocalProfile(nextProfile);
  saveLocalLadder(ranked);
  saveLocalSessions(sessions);

  return {
    profile: nextProfile,
    ladder: ranked,
    sessions,
    wire: localWire(sessions, nextProfile),
    result: {
      ratingBefore,
      ratingAfter,
      delta,
      peak,
      rankBefore,
      rankAfter,
      rd: mine.rd,
      rated: mine.rated,
      provisional: mine.rated < 12,
      expected: mine.expected,
      fieldAvg: Math.round(
        field.reduce((a, f) => a + f.rating, 0) / Math.max(1, field.length),
      ),
    },
  };
}
