# Dealing and selective verification

Implemented on the hardening branch; not a claim of hosted rollout or independent security audit. New private rooms and ranked proposals use version 1 of the exchange below. Existing room states without fairness metadata remain explicitly legacy commitments; their full shuffle seeds also stay private, and no client contributions are fabricated for them.

## Room and hand flow

1. At room creation the backend draws a 256-bit server seed from the platform CSPRNG and publishes its context-bound SHA-256 commitment. Missing secure randomness stops creation; there is no weak fallback.
2. The browser pins that commitment and saves its own random seed in owner/room-scoped session storage. It never puts this secret in a URL, room snapshot or public proof. Same-tab reload/retry reuses it. A missing committed secret or changed commitment fails closed.
3. Private-game preparation, or both ranked confirmations, freezes the participant IDs. Every participant commits before the server accepts any reveal. Commitments and reveals cannot be replaced. Each mutation is revision checked, authenticated, and covered by the game-command receipt transaction.
4. Ranked confirmation retains its 15-second deadline. After both confirm, the seed exchange gets its own 15-second deadline; private preparation uses the same bounded window. Timeout/decline/abort deals no cards and substitutes no seed. Confirmed eligible ranked players keep queue priority without a rating change. Concurrent browser revision conflicts retry the same seed against the new snapshot.
5. The backend checks the pinned commitments and combines the server seed, canonically ordered participant reveals, room context and unique hand ID. The existing deterministic ChaCha20/Fisher–Yates shuffle uses that result. Each later hand uses a distinct context, with the same pinned room contributions.
6. Before dealing in application code, the backend salts all 52 deck positions independently and builds a 64-leaf, domain-separated SHA-256 Merkle tree. The extra leaves are context-bound padding. It records the root with the hand, then deals through the shared engine.
7. Postgres archives the root, public evidence and private audit input in the same transaction as the room revision and acknowledgement. Root replacement is rejected. Completed evidence becomes immutable. Records remain after the live room and its short-lived event replay expire.

JSON arrays provide unambiguous hash input framing. Separate domains bind seed scope, room/player context, hand, leaf position, padding and internal tree nodes. Inputs use canonical lowercase 256-bit hex seeds; participant ordering uses deterministic code-point comparison rather than locale-specific sorting. Each disclosed card proof carries six sibling hashes, its position, hand ID and independent secret salt.

## Public scope

`/verify/[handId]` fetches only the public projection, recomputes disclosed-card membership in the browser, and offers the disclosed proofs for download. It never fetches private audit data. A record with no disclosed cards says only that the commitment was recorded. Unknown and legacy hand IDs do not manufacture verification records.

A live seat may receive proofs for its own cards. The public archive includes only the board and cards actually disclosed at showdown. Folded cards, unused positions, other positions' salts and all complete shuffle seeds remain private, including after settlement and in replayed room events. The public route has no player/room identity list or private transcript.

Membership is **not proof of an unbiased shuffle**, correct seed combination, correct unseen positions, fair abort behavior, or complete application/action correctness. Publishing the complete combined transcript would reconstruct folded cards. No zero-knowledge shuffle proof is implemented. A malicious server can refuse/abort a deal; these proofs do not remove server trust. The page states these limits instead of labeling the shuffle publicly verified.

## Trusted audit and retention

The private archive retains the pinned round, full salted deck and authoritative hand state. `verifyFairAudit` checks seed commitments, re-derivation, root, actual hole-card deal order, board burns and remaining deck. It is an internal function, not a public transcript endpoint. Betting/settlement correctness is covered separately by engine and ledger tests; this function does not claim a complete structured-action replay.

Treat database snapshots and audit archives as sensitive: they contain hidden cards/seeds. Existing account closure retains integrity records and historical snapshots, as disclosed by that workflow. Full retention/erasure/legal policy remains a launch gate; no worldwide compliance claim follows from this implementation.

## Evidence

- Failing-before-fix regressions: absent CSPRNG, settled full-seed disclosure and the missing live commit-before-deal barrier.
- 10,000 deterministic seed/Merkle/engine audit replays; tampered seed/card/position/hand/salt/path rejection; independent Node crypto root calculation.
- Frozen participants, immutable inputs, reveal barrier, persisted round replay, unsupported versions, private projection, browser secret recovery and fail-closed abort tests.
- Isolated Postgres archive: rollback before deal acknowledgement leaves neither deal nor hand record; public/private projections; root replacement rollback; immutable completed evidence; new hand contexts; folded-card exclusion and nine-card showdown proof; verification after room deletion.
- Actual two-browser production smoke: automatic concurrent exchange, same-tab seed persistence, room reload and public verification page.
- Six-seat/spectator realtime privacy, ordered event replay, session revocation and listener recovery continue through the same serializer. Local 500-spectator protected-room test: all 500 receive one real HTTP action, p95 116 ms, maximum 117 ms, 0% spectator failures. Local evidence does not establish hosted/sustained capacity.

Commands are listed in package.json: test:secure-random, test:folded-privacy, test:fair-round, test:client-seed, test:live-fairness, test:fair-deck, test:fair-archive, test:realtime and smoke:browser. Browser smoke needs `npx playwright install chromium` (CI uses `--with-deps`). Database tests must run through the isolated harness.
