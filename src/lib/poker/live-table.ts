import {
  applyAction,
  legalActions,
  newSession,
  startHand,
  START_STACK,
  type BotAction,
  type GameState,
} from "./engine";
import {newFairRound,freezeFairParticipants,commitClientSeed,revealClientSeed,fairTranscript,publicFairRound,abortFairRound,type FairRound} from "./fair-round";
import {deriveFairSeed,sealFairDeck,cardProof,type SealedFairDeck} from "./fair-deck";
import {sha256Hex} from "./rng";
import type { HandValue } from "./evaluator";
import { shortHandLabel } from "./hand-label";
import { HUMAN_TURN_MS } from "./turn-timing";
import { RANKED_HANDS, RANKED_READY_MS } from "./ranked-match";

export const LIVE_CLOCK_MS = HUMAN_TURN_MS;
export const LIVE_CAPACITY = 6;

interface LivePlayer {
  id: string;
  name: string;
  rating: number;
  biggestPot: number;
  potsWon: number;
  bestHand: string | null;
  bestSeen?: HandValue;
  bestWinning?: HandValue;
}

export interface LiveTable {
  host: string;
  players: LivePlayer[];
  status: "waiting" | "playing" | "finished" | "closed";
  game: GameState | null;
  nextAt: number | null;
  handStacks: number[];
  eliminated: number[];
  fair?: {round:FairRound;hand?:SealedFairDeck;evidence?:PublicFairHand};
  ranked?: {
    matchId?: string;
    proposal?: { deadline: number; accepted: boolean[]; declinedBy?: number };
    cancelReason?: string;
    lastSeen?: number[];
    missed?: number[];
    outcome?: {kind:"void";reason:string}|{kind:"forfeit";reason:string;loser:number};
    scores: number[];
    completedHands: number;
    ratings?: { before: number; after: number }[];
  };
}

export type LiveCommand =
  | { type: "join" | "leave" | "start" }
  | { type: "act"; action: BotAction }
  | { type: "ready"; accept: boolean }
  | { type: "seed-commit"; commitment:string }
  | { type: "seed-reveal"; seed:string };

type Identity = Pick<LivePlayer, "id" | "name" | "rating">;

export function newLiveTable(host: Identity, fair=false): LiveTable {
  return {
    host: host.id, players: [seatPlayer(host)], status: "waiting", game: null,
    nextAt: null, handStacks: [], eliminated: [], ...(fair?{fair:{round:newFairRound()}}:{}),
  };
}

export function newRankedTable(a: Identity, b: Identity, now: number): LiveTable {
  const table = newLiveTable(a);
  table.players.push(seatPlayer(b));
  table.ranked = { scores: [0, 0], completedHands: 0, lastSeen: [now, now], missed: [0, 0] };
  startTable(table, now);
  return table;
}

/** Production matchmaking proposes a room without dealing any private cards. */
export function newProposedRankedTable(a: Identity, b: Identity, now: number): LiveTable {
  const table = newLiveTable(a,true);
  table.players.push(seatPlayer(b));
  table.ranked = { scores: [0, 0], completedHands: 0, lastSeen: [now, now], missed: [0, 0], proposal: { deadline: now + RANKED_READY_MS, accepted: [false, false] } };
  table.nextAt = table.ranked.proposal!.deadline;
  return table;
}

function seatPlayer({ id, name, rating }: Identity): LivePlayer {
  return { id, name, rating, biggestPot: 0, potsWon: 0, bestHand: null };
}

function startTable(table: LiveTable, now: number) {
  table.game = newSession(table.players.map((player) => ({ ...player, isHuman: true })), table.ranked ? { fixedBlinds: [10, 20] } : {});
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
  if(table.fair){
    const handId=sha256Hex(`${table.fair.round.context}:${game.handNo+1}`);
    const transcript=fairTranscript(table.fair.round);
    table.fair.hand=sealFairDeck(transcript,handId);
    startHand(game,deriveFairSeed(transcript,handId));
    game.deckCommit=table.fair.hand.root;
    const seal=game.log.findLast(entry=>entry.text.startsWith('deck sealed · commit '));
    if(seal)seal.text=`deck sealed · commit ${game.deckCommit.slice(0,12)}`;
  }else startHand(game);
  scheduleDecision(table, now, true);
}

function scheduleDecision(table: LiveTable, now: number, dealing = false) {
  const game = table.game!;
  if (game.phase === "betting") {
    table.nextAt = now + LIVE_CLOCK_MS + (dealing ? 950 : 0);
    return;
  }
  for (const seat of game.seats) {
    const player = table.players[seat.idx];
    if (seat.revealed && (!player.bestSeen || seat.revealed.score > player.bestSeen.score)) player.bestSeen = seat.revealed;
  }
  for (const award of game.awards ?? []) {
    const player = table.players[award.seatIdx];
    player.potsWon++;
    player.biggestPot = Math.max(player.biggestPot, award.amount);
    if (award.hand && (!player.bestWinning || award.hand.score > player.bestWinning.score)) {
      player.bestWinning = award.hand;
      player.bestHand = award.hand.name;
    }
  }
  table.nextAt = now + (game.phase === "showdown" ? 4_000 : 2_200);
}

/** Both-absent void takes precedence over any single-player forfeit. */
function terminateUnresponsive(table:LiveTable,now:number):boolean {
  if(table.status!=="playing"||!table.ranked||!table.game)return false;
  const ranked=table.ranked;
  const absent=(ranked.lastSeen??[now,now]).map(last=>now-last>=60_000);
  const missed=ranked.missed??[0,0];
  const losers=absent.map((value,idx)=>value||missed[idx]>=3);
  if(!losers.some(Boolean))return false;
  if(absent.every(Boolean)||losers.every(Boolean)){
    ranked.outcome={kind:"void",reason:"both-absent"};table.status="closed";
  }else{
    ranked.outcome={kind:"forfeit",reason:absent.some(Boolean)?"offline":"missed-decisions",loser:losers.findIndex(Boolean)};
    // Include a fully completed, already-awarded hand once; refund an interrupted hand.
    if(table.game.phase!=="betting"&&ranked.completedHands<table.game.handNo){
      for(const seat of table.game.seats)ranked.scores[seat.idx]+=seat.stack-START_STACK;
      ranked.completedHands++;
    }
    table.status="finished";
  }
  for(const seat of table.game.seats){seat.stack+=seat.totalBet;seat.totalBet=0;seat.bet=0;}
  table.game.collected=0;table.game.potTotal=0;table.game.phase="session-end";
  table.nextAt=null;return true;
}

/** Advance expired decisions even if the player closed the tab. */
export function advanceLiveTable(table: LiveTable, now: number): boolean {
  if(table.status==='waiting'&&table.fair&&['committing','revealing'].includes(table.fair.round.phase)&&table.nextAt!==null&&now>=table.nextAt){
    abortFairRound(table.fair.round);table.status='closed';table.nextAt=null;
    if(table.ranked)table.ranked.cancelReason='seed-timeout';
    return true;
  }
  if (table.status === "waiting" && table.ranked?.proposal && now >= table.ranked.proposal.deadline) {
    table.status = "closed"; table.nextAt = null; table.ranked.cancelReason = "ready-timeout";
    return true;
  }
  if (terminateUnresponsive(table,now)) return true;
  const game = table.game;
  if (table.status !== "playing" || !game || table.nextAt === null || now < table.nextAt) return false;

  if (game.phase === "betting") {
    if(table.ranked){table.ranked.missed??=[0,0];table.ranked.missed[game.toAct]++;}
    const action = legalActions(game, game.toAct).canCheck ? "check" : "fold";
    applyAction(game, game.toAct, { type: action });
    scheduleDecision(table, now);
    terminateUnresponsive(table,now);
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
  if(table.ranked&&seat>=0){table.ranked.lastSeen??=[now,now];table.ranked.lastSeen[seat]=now;}
  if(command.type==='seed-commit'||command.type==='seed-reveal'){
    if(seat<0||table.status!=='waiting'||!table.fair)return 'No seed exchange is available for this seat.';
    if(table.nextAt!==null&&now>=table.nextAt)return 'The seed exchange expired.';
    try{
      if(command.type==='seed-commit')commitClientSeed(table.fair.round,player.id,command.commitment);
      else revealClientSeed(table.fair.round,player.id,command.seed);
      if(table.fair.round.phase==='ready')startTable(table,now);
      return null;
    }catch(error){return error instanceof Error?error.message:'Invalid seed exchange.';}
  }
  if (table.ranked?.proposal && table.status === "waiting") {
    if (seat < 0) return "This proposal belongs to its two matched players.";
    if (command.type !== "ready") return "Confirm or decline this ranked proposal.";
    if (now >= table.ranked.proposal.deadline) return "The ready check expired.";
    if (!command.accept) {
      table.ranked.proposal.declinedBy = seat;
      table.ranked.cancelReason = "declined";
      table.status = "closed"; table.nextAt = null;
    } else {
      if (table.ranked.proposal.accepted[seat]) return "You already confirmed.";
      table.ranked.proposal.accepted[seat] = true;
      if (table.ranked.proposal.accepted.every(Boolean)) {
        if(table.fair){
          freezeFairParticipants(table.fair.round,table.players.map(player=>player.id));
          table.ranked.proposal.deadline=now+RANKED_READY_MS;table.nextAt=table.ranked.proposal.deadline;
        }
        else startTable(table, now);
      }
    }
    return null;
  }
  if (command.type === "join") {
    if (seat >= 0) return null;
    if (table.status !== "waiting"||table.fair&&table.fair.round.phase!=="waiting") return "This game has already started.";
    if (table.players.length >= LIVE_CAPACITY) return "All six seats are taken.";
    table.players.push(seatPlayer(player));
    return null;
  }

  if (seat < 0) return "Take a seat first.";
  if (command.type === "leave") {
    if (table.status !== "waiting") return "You can reconnect to a game in progress with the invite link.";
    if(table.fair&&table.fair.round.phase!=='waiting'){
      abortFairRound(table.fair.round);table.status='closed';table.nextAt=null;return null;
    }
    table.players.splice(seat, 1);
    if (!table.players.length) table.status = "closed";
    else if (table.host === player.id) table.host = table.players[0].id;
    return null;
  }

  if (command.type === "start") {
    if (table.host !== player.id || table.status !== "waiting") return "Only the host can start a waiting room.";
    if (table.players.length < 2) return "Invite at least one other player.";
    if(table.fair){
      if(table.fair.round.phase!=='waiting')return 'The private deal is already being prepared.';
      freezeFairParticipants(table.fair.round,table.players.map(player=>player.id));table.nextAt=now+RANKED_READY_MS;
    }else startTable(table, now);
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

  if(table.ranked){table.ranked.missed??=[0,0];table.ranked.missed[seat]=0;}
  applyAction(game, seat, action);
  scheduleDecision(table, now);
  return null;
}

export function liveStandings(table: LiveTable) {
  if (!table.game || table.status !== "finished") return [];
  const ranked = table.ranked;
  const draw = !ranked?.outcome && ranked?.scores[0] === ranked?.scores[1];
  const order = ranked?.outcome?.kind === "forfeit" ? [1-ranked.outcome.loser,ranked.outcome.loser] : ranked ? [0, 1].sort((a, b) => ranked.scores[b] - ranked.scores[a]) : [
    table.game.seats.find((seat) => !seat.out)!.idx,
    ...table.eliminated.slice().reverse(),
  ];
  return order.map((idx, index) => ({
    ...table.players[idx], idx, place: ranked && draw ? 0 : index + 1,
    stack: table.game!.seats[idx].stack,
    net: ranked ? ranked.scores[idx] : table.game!.seats[idx].stack - START_STACK,
  }));
}

/** The only data that can leave the server. No deck, full shuffle seed or hidden hole cards. */
export function publicLiveTable(table: LiveTable, playerId: string, code: string, revision: number) {
  const me = table.players.findIndex((p) => p.id === playerId);
  const g = table.game;
  const revealed = g && g.phase !== "betting";
  return {
    serverNow: Date.now(), code, revision, me, status: table.status,
    fair: table.fair?publicFairRound(table.fair.round):null,
    ranked: table.ranked ? { matchId:table.ranked.matchId,scores:table.ranked.scores,completedHands:table.ranked.completedHands,ratings:table.ranked.ratings,proposal:table.ranked.proposal,cancelReason:table.ranked.cancelReason,outcome:table.ranked.outcome,hands:RANKED_HANDS } : null,
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
      fairProof: table.fair?.hand?{
        handId:table.fair.hand.handId,root:table.fair.hand.root,
        cards:[...g.board,...g.seats.flatMap(seat=>seat.idx===me||(revealed&&seat.revealed)?seat.cards:[])].map(card=>cardProof(table.fair!.hand!,table.fair!.hand!.deck.findIndex(candidate=>candidate.id===card.id))),
      }:null,
      board: g.board, deckCommit: g.deckCommit, deckSeed: null as string | null,
      log: g.log.slice(-24).map(entry => entry.text.startsWith("deck opened · seed ") ? {...entry,text:"hand settled · hidden cards remain private"} : entry), awards: g.awards?.map((a) => ({ seatIdx: a.seatIdx, amount: a.amount, hand: shortHandLabel(a.hand) })) ?? [],
      legal: g.phase === "betting" && g.toAct === me ? legalActions(g, me) : null,
    } : null,
    standings: liveStandings(table).map(({ idx, name, place, stack, net }) => ({ idx, name, place, stack, net })),
  };
}

export type LiveSnapshot = ReturnType<typeof publicLiveTable>;


export interface PublicFairHand {handId:string;root:string;cards:ReturnType<typeof cardProof>[];complete:boolean;aborted:boolean;scope:'disclosed-card-membership-v1'}
/** Persist a spectator projection, never another seat's private proof set. */
export function refreshFairEvidence(table:LiveTable){
 if(!table.fair?.hand||!table.game)return;
 const proof=publicLiveTable(table,'','',0).game!.fairProof!;
 table.fair.evidence={...proof,complete:table.status==='closed'||table.game.phase!=='betting',aborted:table.status==='closed',scope:'disclosed-card-membership-v1'};
}
