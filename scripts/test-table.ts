/* Table-flow verification, headless.
 *
 * The cash-out gate is a promise, not a decoration: a seat cannot settle
 * before ten completed hands, the back arrow cannot bypass it, and the table
 * you were shown in the lobby is the table you sit at.
 */
import { CASH_OUT_MIN_HANDS, useFelt } from "../src/store/game";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.log("FAIL:", msg);
  }
};

useFelt.setState({
  token: "test-player",
  profile: {
    id: "test-player",
    name: "Test Seat",
    rating: 1400,
    rd: 110,
    rated: 3,
    peak: 1420,
    hands: 120,
    cashes: 12,
    netChips: 430,
    biggestPot: 2100,
    streak: 2,
  },
});

useFelt.getState().reseedOffer();
const offer = useFelt.getState().offer;
check(!!offer, "no table offer was built");
check(offer!.opponents.length === 5, "offer did not seat five opponents");

useFelt.getState().seatTable();
const st = useFelt.getState();
check(st.view === "table", "seating did not open the table");
check(st.opponents.length === 5, "table opened with the wrong number of seats");
check(st.tableNo === offer!.tableNo, "table number changed between ticket and seat");
check(
  st.opponents.map((o) => o.id).join() === offer!.opponents.map((b) => `rival_${b.slug}`).join(),
  "the seated opponents are not the ones on the ticket",
);
check(st.completedHands === 0, "a fresh table counted hands before any were played");

// the gate: attempt a cash-out at 0, then at 9 completed hands
await useFelt.getState().leaveTable();
let cur = useFelt.getState();
check(cur.view === "table", "cashed out before playing a hand");
check(cur.cashOutNudge === 1, "locked cash-out did not raise the nudge");

useFelt.setState({ completedHands: CASH_OUT_MIN_HANDS - 1, awaitingHuman: false, legal: null });
await useFelt.getState().leaveTable();
cur = useFelt.getState();
check(cur.view === "table", `cashed out at ${CASH_OUT_MIN_HANDS - 1} hands`);
check(cur.cashOutNudge === 2, "locked cash-out did not raise the nudge the second time");

// the tenth hand: the same action now settles (offline fallback, no server here)
useFelt.setState({ completedHands: CASH_OUT_MIN_HANDS, game: cur.game ? { ...cur.game, phase: "idle" } : null });
await useFelt.getState().leaveTable();
cur = useFelt.getState();
check(cur.view === "settle", "did not settle after ten completed hands");
check(!!cur.settleResult, "settlement produced no receipt");
check(cur.settleResult?.hands === CASH_OUT_MIN_HANDS, `receipt says ${cur.settleResult?.hands} hands`);
check(cur.settleResult?.finalStack === cur.game?.seats.find((x) => x.isHuman)?.stack, "receipt stack mismatch");

// a new table starts the count again at zero
useFelt.getState().playAgain();
cur = useFelt.getState();
check(cur.completedHands === 0, `new table inherited ${cur.completedHands} completed hands`);
check(cur.tableNo !== undefined && cur.tableNo >= 1 && cur.tableNo <= 9, "new table number out of range");

// ---------------------------------------------------------- cash-out rules --
// A busted seat owes the table nothing: zero hands played, zero chips, the
// cash-out is immediate.
const humanWith = (stack: number, phase: string) => {
  const g = useFelt.getState().game;
  if (!g) return null;
  return {
    ...g,
    phase: phase as typeof g.phase,
    seats: g.seats.map((seat) =>
      seat.isHuman ? { ...seat, stack, out: stack <= 0 && phase !== "betting" } : seat,
    ),
  };
};

useFelt.setState({
  view: "table",
  settleResult: null,
  settling: false,
  wantsLeave: false,
  cashOutQueued: false,
  completedHands: 0,
  game: humanWith(0, "idle"),
});
await useFelt.getState().leaveTable();
cur = useFelt.getState();
check(cur.view === "settle", "a busted seat could not cash out immediately");
check(cur.completedHands === 0, "a busted cash-out invented completed hands");

// a live hand is not a cash-out window: the request is queued, not forced
useFelt.getState().playAgain();
useFelt.setState({
  view: "table",
  settleResult: null,
  settling: false,
  wantsLeave: false,
  cashOutQueued: false,
  completedHands: CASH_OUT_MIN_HANDS,
  game: humanWith(2400, "betting"),
});
await useFelt.getState().leaveTable();
cur = useFelt.getState();
check(cur.view === "table", "a mid-hand cash-out settled before the hand ended");
check(cur.cashOutQueued === true, "a mid-hand cash-out was not queued");
check(cur.settleResult === null, "a queued cash-out produced a receipt early");

// and the queue is cancellable
useFelt.getState().cancelCashOut();
cur = useFelt.getState();
check(cur.cashOutQueued === false, "cancelling a queued cash-out left it queued");
check(cur.wantsLeave === false, "cancelling a queued cash-out left wantsLeave set");

// an all-in during a betting round is not a bust: zero stack, still live,
// still under the ten-hand gate — so the cash-out must be refused
useFelt.getState().playAgain();
useFelt.setState({
  view: "table",
  settleResult: null,
  settling: false,
  wantsLeave: false,
  cashOutQueued: false,
  completedHands: CASH_OUT_MIN_HANDS - 1,
  cashOutNudge: 0,
  game: humanWith(0, "betting"),
});
await useFelt.getState().leaveTable();
cur = useFelt.getState();
check(cur.view === "table", "an all-in seat was cashed out mid-hand");
check(cur.cashOutQueued === false, "an all-in seat queued a cash-out");
check(cur.cashOutNudge === 1, "refused all-in cash-out did not nudge");

console.log(
  failures === 0 ? "ALL PASS — ticket integrity + cash-out rules" : `${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);
