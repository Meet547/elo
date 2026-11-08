type Seat = { idx: number; out: boolean };

export function holeCardDelay(seats: readonly Seat[], button: number, idx: number, round: number) {
  const order = [...seats.slice(button + 1), ...seats.slice(0, button + 1)].filter((seat) => !seat.out);
  return (Math.max(0, order.findIndex((seat) => seat.idx === idx)) + round * order.length) * 75;
}

export function boardCardDelay(index: number, runout: boolean) {
  if (runout && index >= 3) return index === 3 ? 620 : 1_080;
  return (index < 3 ? index : 0) * 90;
}

export function isRunout(log: readonly { kind: string; text: string }[]) {
  return log.slice(log.findLastIndex((entry) => entry.kind === "hand"))
    .some((entry) => entry.text === "All-in — running it out.");
}
