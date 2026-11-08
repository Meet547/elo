/* Engine stress test: play many hands with bots, verify invariants. */
import { GameState, applyAction, humanSeat, newSession, START_STACK, activeSeats, aliveSeats, legalActions, startHand, handFinished } from "../src/lib/poker/engine";
import { ROSTER, botDecide, botThinkTime, botView } from "../src/lib/poker/ai";
import { buildTableOffer } from "../src/lib/matchmaking";
import { deckFromSeed, secureDeck, verifyDeck } from "../src/lib/poker/cards";
import { randomSeedHex } from "../src/lib/poker/rng";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.log("FAIL:", msg);
}

function makeSession(): GameState {
  const bots = buildTableOffer({ rating: 1200, rd: 110 }).opponents;
  return newSession([
    { id: "human", name: "You", isHuman: true, rating: 1200 },
    ...bots.map((b) => ({ id: b.slug, name: b.name, isHuman: false, rating: b.rating, persona: b.persona })),
  ]);
}

function playHand(s: GameState, maxSteps = 400): void {
  startHand(s);
  // every hand must reproduce its published commit from the revealed seed
  const proof = verifyDeck(s.deckSeed, s.deckCommit);
  if (!proof.valid) fail(`hand ${s.handNo} deck commit did not verify`);
  if (new Set(proof.deck.map((c) => c.id)).size !== 52) fail(`hand ${s.handNo} deck is not 52 unique cards`);
  const startSum = s.seats.reduce((a, x) => a + x.stack + x.totalBet, 0);
  const dealOrder = [...s.seats.slice(s.button + 1), ...s.seats.slice(0, s.button + 1)].filter((seat) => !seat.out);
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) {
      if (seat.cards[round]?.id !== proof.deck.pop()?.id) fail(`hand ${s.handNo} dealt out of order`);
    }
  }
  const expectedBoard = [3, 1, 1].flatMap((count) => {
    proof.deck.pop();
    return Array.from({ length: count }, () => proof.deck.pop()?.id);
  });
  const humans = s.seats.filter((x) => x.isHuman && !x.out);

  let steps = 0;
  // betting loop (human replaced by a bot mind for the test)
  while (s.phase === "betting") {
    if (++steps > maxSteps) {
      fail(`hand ${s.handNo} betting loop did not terminate`);
      return;
    }
    const idx = s.toAct;
    const seat = s.seats[idx];
    // the bot decides from its restricted view only — never the raw state
    const action = botDecide(botView(s, idx));
    // validate action legality
    const la = legalActions(s, idx);
    if (action.type === "check" && !la.canCheck) fail(`illegal check by ${seat.name} [${s.street} cb=${s.currentBet} bet=${seat.bet}]`);
    if (action.type === "call" && la.callAmount <= 0 && !la.canCheck) fail(`illegal call by ${seat.name} [${s.street} cb=${s.currentBet} bet=${seat.bet} stack=${seat.stack} toCall=${la.callAmount}]`);
    if (action.type === "raise" && !la.canRaise) fail(`illegal raise by ${seat.name} (${JSON.stringify(action)}) [${s.street}]`);
    applyAction(s, idx, action);
  }
  if (s.board.some((card, index) => card.id !== expectedBoard[index])) fail(`hand ${s.handNo} used the wrong board burn`);
  if (s.phase === "hand-end" || s.phase === "showdown") handFinished(s);

  const endSum = s.seats.reduce((a, x) => a + x.stack, 0);
  if (Math.abs(endSum - startSum) > 0) {
    fail(`hand ${s.handNo} money leak: start ${startSum} end ${endSum} (delta ${endSum - startSum})`);
  }
  // pot empty after award
  if (activeSeats(s).length > 1 && s.phase !== "session-end") {
    const betSum = s.seats.reduce((a, x) => a + x.bet, 0);
    if (betSum !== 0) fail(`hand ${s.handNo} bets not collected: ${betSum}`);
  }
}

// ---- run 4000 hands across sessions ----
const t0 = Date.now();
let hands = 0;
let sessions = 0;
let showdowns = 0;
let splitPots = 0;
let allIns = 0;

for (let sess = 0; sess < 800; sess++) {
  const s = makeSession();
  sessions++;
  let guard = 0;
  while (s.phase !== "session-end") {
    playHand(s);
    hands++;
    if (++guard > 200) {
      fail(`session ${sess} did not end after 200 hands`);
      break;
    }
    for (const l of s.log) if (l.kind === "result" && l.text.includes("wins")) showdowns++;
    for (const l of s.log) if (l.text.includes("Split pot")) splitPots++;
    for (const l of s.log) if (l.text.includes("all-in")) allIns++;
    // stack sanity
    for (const seat of s.seats) {
      if (seat.stack < 0) fail(`negative stack ${seat.name} ${seat.stack}`);
      if (!Number.isInteger(seat.stack)) fail(`non-integer stack ${seat.name} ${seat.stack}`);
    }
  }
  // session end: exactly one player holds all chips (or human busted)
  const alive = aliveSeats(s);
  const human = humanSeat(s);
  if (alive.length === 1 && !human.out) {
    const total = s.seats.reduce((a, x) => a + x.stack, 0);
    if (total !== START_STACK * 6) fail(`session end chips ${total} != ${START_STACK * 6}`);
  }
}

console.log(`played ${hands} hands in ${sessions} sessions, ${Date.now() - t0}ms`);
console.log(`showdown results: ${showdowns}, splits: ${splitPots}, all-in mentions: ${allIns}`);

// ---- legality fuzz: human-style actions on random states ----
for (let i = 0; i < 3000; i++) {
  const s = makeSession();
  startHand(s);
  let steps = 0;
  while (s.phase === "betting" && steps++ < 60) {
    const idx = s.toAct;
    const la = legalActions(s, idx);
    const roll = Math.random();
    let action;
    if (roll < 0.15) action = { type: "fold" as const };
    else if (roll < 0.45 && la.canCheck) action = { type: "check" as const };
    else if (roll < 0.7) action = { type: "call" as const };
    else if (la.canRaise) {
      const span = la.maxRaiseTo - la.minRaiseTo;
      const to = la.minRaiseTo + Math.floor(Math.random() * (span + 1));
      action = { type: "raise" as const, to };
    } else action = { type: "call" as const };
    const before = s.seats.reduce((a, x) => a + x.stack + x.totalBet, 0);
    applyAction(s, idx, action);
    const after = s.seats.reduce((a, x) => a + x.stack + x.totalBet, 0);
    if (before !== after) fail(`fuzz: money changed on apply ${before}→${after}`);
  }
  if (s.phase === "betting" && steps >= 60) fail("fuzz: betting loop stuck");
  handFinished(s);
}
console.log("fuzz legality: done");

// ---- heads-up edge: two players left ----
for (let i = 0; i < 500; i++) {
  const s = newSession([
    { id: "h", name: "You", isHuman: true, rating: 1200 },
    { id: "b1", name: "Bot A", isHuman: false, rating: 1200, persona: ROSTER[0].persona },
  ]);
  let guard = 0;
  while (s.phase !== "session-end" && guard++ < 200) playHand(s);
  const total = s.seats.reduce((a, x) => a + x.stack, 0);
  if (total !== START_STACK * 2) fail(`heads-up chips ${total}`);
}
console.log("heads-up: done");

// ---- think-time sanity ----
{
  const s = makeSession();
  startHand(s);
  const tt = botThinkTime(botView(s, s.toAct));
  if (tt < 300 || tt > 3500) fail(`think time out of range: ${tt}`);
}

// ---- fairness: the BotView must never carry other seats' cards or the deck ----
{
  const s = makeSession();
  startHand(s);
  const view = botView(s, s.toAct);
  const viewKeys = Object.keys(view);
  const forbidden = ["deck", "seats", "cards"];
  for (const k of forbidden) {
    if (viewKeys.includes(k)) fail(`BotView leaks field: ${k}`);
  }
  const others = s.seats.filter((x) => x.idx !== s.toAct);
  const leaked = JSON.stringify(view).match(/"id":"[shdc]"/g) ?? []; // raw card literals
  if (leaked.length > 2) fail(`BotView carries more than its own two cards (${leaked.length})`);
  for (const other of others) {
    for (const c of other.cards) {
      if (JSON.stringify(view).includes(`"r":${c.r},"s":"${c.s}"`)) {
        fail(`BotView leaks ${other.name}'s card`);
      }
    }
  }
}

// ---- shuffle legitimacy: determinism, proof, and uniform positions ----
{
  const a = secureDeck();
  if (a.deck.length !== 52) fail("deck size wrong");
  if (new Set(a.deck.map((c) => c.id)).size !== 52) fail("duplicate card in deck");
  const replay = deckFromSeed(a.seed);
  if (replay.map((c) => c.id).join() !== a.deck.map((c) => c.id).join()) {
    fail("seed does not reproduce the deck");
  }
  if (!verifyDeck(a.seed, a.commit).valid) fail("fresh deck commit does not verify");
  if (verifyDeck(a.seed, a.commit.replace(/^./, (c) => (c === "0" ? "1" : "0"))).valid) {
    fail("a tampered commit verified");
  }
  if (secureDeck().commit === secureDeck().commit) fail("commit collision on back-to-back shuffles");

  // position uniformity: every card must reach every one of the 52 positions
  // with equal probability. 26,000 decks = 500 draws per card per position.
  // χ² with 51 df; the 99.99% critical value is ~95, so 110 is a real alarm.
  const N = 26_000;
  const positions: Map<string, number>[] = Array.from({ length: 52 }, () => new Map());
  for (let i = 0; i < N; i++) {
    const deck = deckFromSeed(randomSeedHex());
    for (let p = 0; p < 52; p++) {
      const id = deck[p].id;
      positions[p].set(id, (positions[p].get(id) ?? 0) + 1);
    }
  }
  const expected = N / 52;
  let worstChi = 0;
  positions.forEach((counts, p) => {
    if (counts.size !== 52) fail(`position ${p} only saw ${counts.size} distinct cards`);
    let chi = 0;
    for (const c of counts.values()) chi += (c - expected) ** 2 / expected;
    worstChi = Math.max(worstChi, chi);
  });
  if (worstChi > 110) fail(`position distribution off: worst chi-square ${worstChi.toFixed(1)} (df 51)`);
  console.log(`shuffle uniformity: worst position chi-square ${worstChi.toFixed(1)} (df 51, alarm > 110)`);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures ? 1 : 0);
