/* Evaluator sanity tests */
import { freshDeck, Card } from "../src/lib/poker/cards";
import { evaluate, quickEquity } from "../src/lib/poker/evaluator";

function mk(str: string): Card[] {
  return str.split(" ").map((t) => {
    const rc = "23456789TJQKA".indexOf(t[0]) + 2;
    return { r: rc, s: t[1] as Card["s"], id: t };
  });
}

let fails = 0;
function check(str: string, wantCat: number, wantName: string) {
  const [board, ...holes] = str.split("|");
  const cards = mk(board.trim());
  for (const h of holes) cards.push(...mk(h.trim()));
  const v = evaluate(cards);
  const ok = v.cat === wantCat && v.name === wantName;
  if (!ok) {
    fails++;
    console.log(`FAIL ${str} → cat ${v.cat} "${v.name}" (want ${wantCat} "${wantName}")`);
  } else {
    console.log(`ok   ${str.padEnd(34)} → ${v.name} [${v.score}]`);
  }
}

// category / name checks
check("2h 3h 4h 5h 6h 9c 9d", 8, "Straight Flush, Six High");
check("As Ks Qs Js Ts 2h 3d", 8, "Royal Flush");
check("9c 9d 9h 9s 2h 3d 4c", 7, "Four of a Kind, Nines");
check("Kc Kd Kh 4h 4s 2d 3c", 6, "Full House, Kings over Fours");
check("Ac Qc 9c 5c 2c Kh 3d", 5, "Flush, Ace High");
check("9c Td Jh Qs Kc 2h 2d", 4, "Straight, King High");
check("Ac 2d 3h 4s 5h Kc Qc", 4, "Straight, Five High"); // wheel
check("7c 7d 7h As 2d 3c 4h", 3, "Three of a Kind, Sevens");
check("Ac Ad 9h 9s 2c 3d 4h", 2, "Two Pair, Aces and Nines");
check("Qc Qd 9h 5s 2c 3d 4h", 1, "Pair of Queens");
check("Ac Jd 9h 5s 2c 3d 8h", 0, "High Card Ace");

// best-5-of-7 picks the best combo
const royal = evaluate(mk("As Ks Qs Js Ts 2s 3s"));
console.log("royal board:", royal.name, royal.score);

// score ordering: quads > full house > flush
const a = evaluate(mk("9c 9d 9h 9s 2h 3d 4c")).score;
const b = evaluate(mk("Kc Kd Kh 4h 4s 2d 3c")).score;
const c = evaluate(mk("Ac Qc 9c 5c 2c Kh 3d")).score;
console.log("quads>boat>flush:", a > b && b > c ? "ok" : "FAIL");

// equity sanity: AA preflop high, 72o low
const aa = quickEquity(mk("As Ad"), []);
const trash = quickEquity(mk("7c 2d"), []);
console.log(`equity AA=${aa.toFixed(2)} 72o=${trash.toFixed(2)}`, aa > 0.8 && trash < 0.25 ? "ok" : "FAIL");

// stress: evaluate 200k random 7-card hands, no crash, monotonic score spread
const deck = freshDeck();
let minS = 1e9, maxS = -1;
const t0 = Date.now();
for (let i = 0; i < 200000; i++) {
  for (let j = 0; j < 7; j++) {
    const k = j + Math.floor(Math.random() * (52 - j));
    [deck[j], deck[k]] = [deck[k], deck[j]];
  }
  const s = evaluate(deck.slice(0, 7)).score;
  if (s < minS) minS = s;
  if (s > maxS) maxS = s;
}
console.log(`stress 200k in ${Date.now() - t0}ms, spread ${minS}..${maxS} ${minS < maxS ? "ok" : "FAIL"}`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
