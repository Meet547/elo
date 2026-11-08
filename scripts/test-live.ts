import assert from "node:assert/strict";
import { verifyDeck } from "../src/lib/poker/cards";
import { START_STACK } from "../src/lib/poker/engine";
import { advanceLiveTable, applyLiveCommand, liveStandings, newLiveTable, publicLiveTable } from "../src/lib/poker/live-table";

const host = { id: "host", name: "Host", rating: 1200 };
const guest = { id: "guest", name: "Guest", rating: 1200 };
const spectator = { id: "spectator", name: "Spectator", rating: 1200 };
const table = newLiveTable(host);
const now = Date.now();
assert.ok(applyLiveCommand(table, host, { type: "start" }, now));
assert.equal(applyLiveCommand(table, guest, { type: "join" }, now), null);
assert.ok(applyLiveCommand(table, guest, { type: "start" }, now));
assert.equal(applyLiveCommand(table, host, { type: "start" }, now), null);

const game = table.game!;
const hostView = publicLiveTable(table, host.id, "TEST", 0);
const guestView = publicLiveTable(table, guest.id, "TEST", 0);
assert.equal(hostView.game?.deckSeed, null);
assert(!("deck" in hostView.game!));
assert.equal(hostView.seats[0].cards.length, 2);
assert.equal(hostView.seats[1].cards.length, 0);
assert.equal(guestView.seats[0].cards.length, 0);
assert.equal(guestView.seats[1].cards.length, 2);
assert(publicLiveTable(table, spectator.id, "TEST", 0).seats.every((seat) => seat.cards.length === 0));

const players = [host, guest];
const actor = players[game.toAct];
const other = players[1 - game.toAct];
assert.ok(applyLiveCommand(table, other, { type: "act", action: { type: "fold" } }, now));
assert.ok(applyLiveCommand(table, actor, { type: "act", action: { type: "raise", to: 10_000 } }, now));
assert.equal(applyLiveCommand(table, actor, { type: "act", action: { type: "raise", to: START_STACK } }, now), null);
assert.equal(applyLiveCommand(table, other, { type: "act", action: { type: "call" } }, now), null);

assert.equal(game.board.length, 5);
assert.equal(game.phase, "showdown");
const result = publicLiveTable(table, guest.id, "TEST", 1);
assert(verifyDeck(result.game!.deckSeed!, result.game!.deckCommit).valid);
assert.equal(advanceLiveTable(table, table.nextAt! - 1), false);
assert.equal(advanceLiveTable(table, table.nextAt!), true);
// A split pot starts the next hand immediately, so its posted blinds still count.
const unsettled = table.status === "playing" ? game.collected + game.seats.reduce((sum, seat) => sum + seat.bet, 0) : 0;
assert.equal(game.seats.reduce((total, seat) => total + seat.stack, 0) + unsettled, START_STACK * 2);
if (table.status === "finished") {
  assert.equal(liveStandings(table)[0].stack, START_STACK * 2);
  assert.equal(liveStandings(table)[1].stack, 0);
}

const timeout = newLiveTable(host);
assert.equal(applyLiveCommand(timeout, guest, { type: "join" }, now), null);
assert.equal(applyLiveCommand(timeout, host, { type: "start" }, now), null);
const expired = timeout.game!.toAct;
assert(advanceLiveTable(timeout, timeout.nextAt!));
assert.equal(timeout.game!.seats[expired].lastAction, "fold");
console.log("ALL PASS — live authorization, private cards, legal actions, timeout, and shuffle proof");
