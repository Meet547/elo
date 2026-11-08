import assert from "node:assert/strict";
import { chooseRankedOpponent, rankedRange, RANKED_HANDS, RANKED_MAX_RANGE } from "../src/lib/poker/ranked-match";
import { advanceLiveTable, applyLiveCommand, liveStandings, newRankedTable } from "../src/lib/poker/live-table";
import { START_STACK } from "../src/lib/poker/engine";
import { applySession } from "../src/lib/rating";

const now = 1_800_000_000_000;
const entry = (playerId: string, rating: number, wait = 0, lastSeen = now) => ({
  playerId, rating, joinedAt: new Date(now - wait), seenAt: new Date(lastSeen),
});
const me = entry("me", 1200);
assert.equal(rankedRange(now, now), 75);
assert.equal(rankedRange(now - 20_000, now), 125);
assert.equal(rankedRange(now - 1_000_000, now), RANKED_MAX_RANGE);
assert.equal(chooseRankedOpponent(me, [me], now), undefined);
assert.equal(chooseRankedOpponent(me, [entry("far", 1600)], now), undefined);
assert.equal(chooseRankedOpponent(me, [entry("old", 1201, 0, now - 46_000)], now), undefined);
assert.equal(chooseRankedOpponent(me, [entry("a", 1240), entry("b", 1205)], now)?.playerId, "b");
assert.equal(chooseRankedOpponent(me, [entry("a", 1240), entry("b", 1240, 10_000)], now)?.playerId, "b");
assert.equal(chooseRankedOpponent(entry("me", 1200, 100_000), [entry("new", 1400)], now), undefined);
assert.equal(chooseRankedOpponent(entry("me", 1200, 100_000), [entry("older", 1400, 100_000)], now)?.playerId, "older");

const players = [
  { id: "a", name: "A", rating: 1200 },
  { id: "b", name: "B", rating: 1220 },
];
for (let match = 0; match < 40; match++) {
  const table = newRankedTable(players[0], players[1], now);
  let time = now;
  const expected = [0, 0];
  const firstButton = table.game!.button;
  for (let hand = 1; hand <= RANKED_HANDS; hand++) {
    const game = table.game!;
    assert.equal(game.handNo, hand);
    assert.equal(game.button, (firstButton + hand - 1) % 2);
    assert(game.seats.every((seat) => seat.stack + seat.totalBet === START_STACK && !seat.out));
    while (game.phase === "betting") {
      const seat = game.toAct;
      const action = hand === 1 && game.seats.every((s) => !s.allIn)
        ? { type: "raise" as const, to: START_STACK }
        : game.seats.some((s) => s.allIn) ? { type: "call" as const } : { type: "fold" as const };
      assert.equal(applyLiveCommand(table, players[seat], { type: "act", action }, time), null);
    }
    for (const seat of game.seats) expected[seat.idx] += seat.stack - START_STACK;
    assert.equal(advanceLiveTable(table, table.nextAt! - 1), false);
    time = table.nextAt!;
    assert(advanceLiveTable(table, time));
    assert.equal(table.ranked!.completedHands, hand);
    assert.deepEqual(table.ranked!.scores, expected);
    assert.equal(table.status, hand === RANKED_HANDS ? "finished" : "playing");
  }
  assert.equal(table.ranked!.scores.reduce((a, b) => a + b), 0);
  assert.equal(advanceLiveTable(table, time + 60_000), false);
  assert.equal(liveStandings(table).length, 2);
}

const draw = newRankedTable(players[0], players[1], now);
draw.status = "finished";
draw.game!.phase = "session-end";
draw.ranked!.completedHands = 10;
draw.ranked!.scores = [0, 0];
assert(liveStandings(draw).every((seat) => seat.place === 0 && seat.net === 0));
const tiedRating = applySession({ rating: 1200, rd: 110, volatility: 0.06, rated: 0 }, [{ rating: 1200, rd: 110, place: 0 }], 0);
assert.equal(tiedRating.delta, 0);

const disconnected = newRankedTable(players[0], players[1], now);
assert(advanceLiveTable(disconnected, disconnected.nextAt!));
assert.equal(disconnected.game!.phase, "hand-end");
assert(advanceLiveTable(disconnected, disconnected.nextAt!));
assert.equal(disconnected.ranked!.completedHands, 1);
assert.equal(disconnected.status, "playing");
assert.equal(disconnected.game!.handNo, 2);
console.log("ALL PASS — rating windows, closest opponent, stale queue exclusion, ten hands, fresh stacks, scores and draws");
