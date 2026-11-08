import {
  applyAction,
  legalActions,
  newSession,
  startHand,
  START_STACK,
  type BotAction,
  type GameState,
} from "./engine";
import { shortHandLabel } from "./hand-label";
import { HUMAN_TURN_MS } from "./turn-timing";
import { RANKED_HANDS } from "./ranked-match";

export const LIVE_CLOCK_MS = HUMAN_TURN_MS;
export const LIVE_CAPACITY = 6;

interface LivePlayer {
  id: string;
  name: string;
  rating: number;
  biggestPot: number;
  potsWon: number;
  bestHand: string | null;
}

export interface LiveTable {
  host: string;
  players: LivePlayer[];
  status: "waiting" | "playing" | "finished" | "closed";
  game: GameState | null;
  nextAt: number | null;
  handStacks: number[];
  eliminated: number[];
  ranked?: {
    matchId?: string;
    scores: number[];
    completedHands: number;
    ratings?: { before: number; after: number }[];
  };
}

export type LiveCommand =
  | { type: "join" | "leave" | "start" }
  | { type: "act"; action: BotAction };

type Identity = Pick<LivePlayer, "id" | "name" | "rating">;

export function newLiveTable(host: Identity): LiveTable {
  return {
    host: host.id, players: [seatPlayer(host)], status: "waiting", game: null,
    nextAt: null, handStacks: [], eliminated: [],
  };
}

export function newRankedTable(a: Identity, b: Identity, now: number): LiveTable {
  const table = newLiveTable(a);
  table.players.push(seatPlayer(b));
  table.ranked = { scores: [0, 0], completedHands: 0 };
  startTable(table, now);
  return table;
}

function seatPlayer({ id, name, rating }: Identity): LivePlayer {
  return { id, name, rating, biggestPot: 0, potsWon: 0, bestHand: null };
}

function startTable(table: LiveTable, now: number) {
  table.game = newSession(table.players.map((player) => ({ ...player, isHuman: true })));
  table.status = "playing";
  nextHand(table, now);
}

function finishTable(table: LiveTable) {
  table.game!.phase = "session-end";
  table.status = "finished";
  table.nextAt = null;
}

function nextHand(table: LiveTable, now: number) {
  const game = table.game!;
  table.handStacks = game.seats.map((seat) => seat.stack);
  startHand(game);
  scheduleDecision(table, now, true);
}

function scheduleDecision(table: LiveTable, now: number, dealing = false) {
  const game = table.game!;
  if (game.phase === "betting") {
    table.nextAt = now + LIVE_CLOCK_MS + (dealing ? 950 : 0);
    return;
  }
  for (const award of game.awards ?? []) {
    const player = table.players[award.seatIdx];
    player.potsWon++;
    player.biggestPot = Math.max(player.biggestPot, award.amount);
    if (award.hand && !player.bestHand) player.bestHand = award.hand.name;
  }
  table.nextAt = now + (game.phase === "showdown" ? 4_000 : 2_200);
}

/** Advance expired decisions even if the player closed the tab. */
export function advanceLiveTable(table: LiveTable, now: number): boolean {
  const game = table.game;
  if (table.status !== "playing" || !game || table.nextAt === null || now < table.nextAt) return false;

  if (game.phase === "betting") {
    const action = "fold";
    applyAction(game, game.toAct, { type: action });
    scheduleDecision(table, now);
    return true;
  }

  if (table.ranked) {
    for (const seat of game.seats) table.ranked.scores[seat.idx] += seat.stack - START_STACK;
    table.ranked.completedHands++;
    if (table.ranked.completedHands === RANKED_HANDS) {
      finishTable(table);
    } else {
      for (const seat of game.seats) seat.stack = START_STACK;
      nextHand(table, now);
    }
    return true;
  }

  const busted = game.seats.filter((seat) => !seat.out && seat.stack === 0)
    .sort((a, b) => table.handStacks[a.idx] - table.handStacks[b.idx] || b.idx - a.idx);
  for (const seat of busted) {
    seat.out = true;
    table.eliminated.push(seat.idx);
  }
  if (game.seats.filter((seat) => !seat.out).length === 1) {
    finishTable(table);
  } else {
    nextHand(table, now);
  }
  return true;
}

export function applyLiveCommand(table: LiveTable, player: Identity, command: LiveCommand, now: number): string | null {
  if (table.status === "finished" || table.status === "closed") return "This room is finished.";
  const seat = table.players.findIndex((p) => p.id === player.id);
  if (command.type === "join") {
    if (seat >= 0) return null;
    if (table.status !== "waiting") return "This game has already started.";
    if (table.players.length >= LIVE_CAPACITY) return "All six seats are taken.";
    table.players.push(seatPlayer(player));
    return null;
  }

  if (seat < 0) return "Take a seat first.";
  if (command.type === "leave") {
    if (table.status !== "waiting") return "You can reconnect to a game in progress with the invite link.";
    table.players.splice(seat, 1);
    if (!table.players.length) table.status = "closed";
    else if (table.host === player.id) table.host = table.players[0].id;
    return null;
  }

  if (command.type === "start") {
    if (table.host !== player.id || table.status !== "waiting") return "Only the host can start a waiting room.";
    if (table.players.length < 2) return "Invite at least one other player.";
    startTable(table, now);
    return null;
  }

  if (command.type !== "act") return "Unknown action.";
  const game = table.game;
  if (!game || game.phase !== "betting" || game.toAct !== seat) return "It is not your turn.";
  if (table.nextAt !== null && now >= table.nextAt) return "Your decision clock expired.";
  const { action } = command;
  const legal = legalActions(game, seat);
  if (
    (action.type === "check" && !legal.canCheck) ||
    (action.type === "call" && !legal.canCall) ||
    (action.type === "raise" && (!legal.canRaise || !Number.isSafeInteger(action.to) ||
      action.to < legal.minRaiseTo || action.to > legal.maxRaiseTo))
  ) return "That move is not available.";

  applyAction(game, seat, action);
  scheduleDecision(table, now);
  return null;
}

export function liveStandings(table: LiveTable) {
  if (!table.game || table.status !== "finished") return [];
  const ranked = table.ranked;
  const draw = ranked?.scores[0] === ranked?.scores[1];
  const order = ranked ? [0, 1].sort((a, b) => ranked.scores[b] - ranked.scores[a]) : [
    table.game.seats.find((seat) => !seat.out)!.idx,
    ...table.eliminated.slice().reverse(),
  ];
  return order.map((idx, index) => ({
    ...table.players[idx], idx, place: ranked && draw ? 0 : index + 1,
    stack: table.game!.seats[idx].stack,
    net: ranked ? ranked.scores[idx] : table.game!.seats[idx].stack - START_STACK,
  }));
}

/** The only data that can leave the server. No deck, live seed or hidden hole cards. */
export function publicLiveTable(table: LiveTable, playerId: string, code: string, revision: number) {
  const me = table.players.findIndex((p) => p.id === playerId);
  const g = table.game;
  const revealed = g && g.phase !== "betting";
  return {
    code, revision, me, status: table.status,
    ranked: table.ranked ? { ...table.ranked, hands: RANKED_HANDS } : null,
    host: table.players.findIndex((p) => p.id === table.host),
    nextAt: table.nextAt,
    seats: table.players.map((p, idx) => {
      const seat = g?.seats[idx];
      return {
        idx, name: p.name, rating: p.rating, stack: seat?.stack ?? START_STACK,
        bet: seat?.bet ?? 0, folded: seat?.folded ?? false, out: seat?.out ?? false,
        allIn: seat?.allIn ?? false, lastAction: seat?.lastAction ?? "",
        cardCount: seat?.cards.length ?? 0,
        cards: seat && (idx === me || (revealed && seat.revealed)) ? seat.cards : [],
      };
    }),
    game: g ? {
      handNo: g.handNo, phase: g.phase, street: g.street, button: g.button,
      toAct: g.toAct, sb: g.sb, bb: g.bb, pot: g.collected + g.seats.reduce((sum, s) => sum + s.bet, 0),
      board: g.board, deckCommit: g.deckCommit, deckSeed: revealed ? g.deckSeed : null,
      log: g.log.slice(-24), awards: g.awards?.map((a) => ({ seatIdx: a.seatIdx, amount: a.amount, hand: shortHandLabel(a.hand) })) ?? [],
      legal: g.phase === "betting" && g.toAct === me ? legalActions(g, me) : null,
    } : null,
    standings: liveStandings(table).map(({ idx, name, place, stack, net }) => ({ idx, name, place, stack, net })),
  };
}

export type LiveSnapshot = ReturnType<typeof publicLiveTable>;
