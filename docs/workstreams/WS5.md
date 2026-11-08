# WS5 — game engine correctness

Implemented locally on the hardening branch; production deployment and broader lifecycle/product work remain pending.

## Intentional rule changes

- Each seat records the street bet level at its last action. Reopening depends on the increase it now faces versus the last full raise, including cumulative short all-ins; it never compares lifetime hand contributions to a street bet.
- Human timeout checks when no chips are owed and folds when facing a bet, in both live and practice. The human/bot decision budgets remain 20/10 seconds. Existing strict-free-fold presentation expectations were updated for the explicitly approved rule change.
- Ranked games use fixed 10/20 blinds for all ten hands. Practice/private tournament schedules retain their existing escalation.
- Best winning hands replace older records only on a higher evaluation score. Best seen (evaluated showdown hands, including losses) is tracked separately. Ranked history persists both descriptions and scores; legacy rows keep null scores rather than invented evaluations. Private/practice history persistence remains WS12.
- A lone player who has already covered the current bet against all-in opponents proceeds to runout, without an unnecessary opportunity to fold an uncontested side pot.
- An unmatched top contribution is returned before distributing contested pots. It is not recorded as a winning pot or hand.

The last two defects were discovered during invariant work. Fixture 644 reproduced 1,388 missing chips after two side-pot contenders folded on successive streets. The first fold should already have triggered runout. A minimal fixed-seed regression failed before correcting round completion. A separate regression proved uncalled refunds were incorrectly reported as winning hands, before the refund correction.

## Regression and independent cases

Before implementation four separate regression cases failed: later-street 100→150 reopening, free-check timeout fold, hand-nine blind increase, and a stronger later winning hand being ignored. All now pass.

Hand-computed cases include one and cumulative short all-ins; a 40-chip short call against two 100-chip contributions (120 main/120 side); 100/200/300 contributions (300 main/200 side/100 returned); a 201-chip split awarding the odd chip first left of the button; and four contributions 50/100/150/200 producing final awards/refund totals 100/250/100/50. Tests also ensure later weaker wins cannot downgrade records and losing hands do not create winning records.

100,000 deterministic hands use two to six seats, seeded action selection, reproducible shuffle seeds, and varied stacks including short blind all-ins. Every action preserves chips and nonnegative integer stacks; all live card identities are unique; each hand terminates; rebuilding from the same seed and action log produces identical final state. The full run passes locally. Replay seed injection is an internal engine argument; no client API accepts a chosen server shuffle seed.

Reference for reopening and minimum full-raise interpretation: [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/). This prototype uses its approved 20-second decision clock, not the TDA live-event clock duration.
