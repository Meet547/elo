# Architecture decisions

## D001 — Isolated implementation and evidence

Work is based on main commit 381e466 in an isolated branch. Reproductions, migrations, crash tests and load tests use task-owned databases. No production data/ratings/database writes or paid provisioning. Review files are retained with repository-relative source links.

## D002 — Owner-approved prototype choices

Free prototype, approximately 100 users, preserve existing history. Use Google OAuth, optional configured email magic link, Neon Postgres, local browser practice heuristics, verified ranked identities and placements, fixed ranked blinds, no rating season resets, approved standard inactivity RD growth, Postgres fan-out, selective reveal, owner-private unrated history and owner-only administration. Keep the temporary frontend origin and host-only cookie proxy. Admin identity is configured privately through ADMIN_EMAILS.

## D003 — External access is a verification gate

Google/Neon/email/Sentry accounts and staging require setup. A current production export has not been supplied. A local SQLite copy may be used for rehearsal but is not assumed current. Implement adapters and test isolated cases; do not fabricate credentials, silently discard data or claim staging validation happened.

## D004 — Minimum age and legal surfaces

The owner requests age 12+ worldwide and defers legal/parental-consent work. Retain that intended audience in planning, but gate underage personal-data registration and public legal text until the process/copy is approved. Do not publish a generic policy as a declaration of compliance. No real-money features.

## D005 — Free hosting and deadlines

Provide a durable database-backed worker, resumable events and deadline catch-up. Test continuously running local workers. A sleeping free web service cannot guarantee continuously executed deadlines; leave that deployment acceptance item deferred with the owner rather than hiding it with browser polling or claiming an always-on SLA.

## D006 — Selective verification scope

Publishing every seed that deterministically derives a deck reveals folded cards. With selective reveal, publish salted per-position membership proofs and test full seed derivation privately; the public verifier must state exactly which guarantees it verifies. Do not claim a public full-deck seed audit without disclosing the deck. This constraint is inherent in the selected privacy choice.

## D007 — Preserve rules until their approved workstream

The existing rating formula and default behavior stay unchanged until their regression tests and explicit workstream changes. Approved changes include check-when-legal timeouts, fixed ranked 10/20, ready checks and forfeit/void rules, real routes, removal of legacy house rating settlement, separate real ladder and persistent unranked results. Each receives its own tests and changelog entry.

## D008 — Local Postgres prerequisite before ranked constraints

The approved durable database target is Postgres. Move the active Prisma schema to Postgres before WS1 constraints instead of designing and discarding a second SQLite settlement migration. Preserve the original SQLite schema/history as a conversion reference. Integration tooling refuses remote hosts and non-test database names, and its default disposable container is loopback-only. This commit is not a production migration or permission to connect to production.

## D009 — Database-enforced ranked settlement

Each new ranked game has a Match identity with conditional state transitions, frozen pre-match rating snapshots, a unique MatchSettlement and unique match/player history. Settlement writes and queue release are atomic with the terminal room revision. Every player command against a finished/closed room rejects without writes. The old client-described house rating path and its switch are removed; browser practice produces an unrated receipt. WS6 will replace compatibility automatic readiness transitions with player-confirmed readiness.

## D010 — Crash verification without application test hooks

The crash fixture holds a task-owned Postgres advisory lock through a test-only database trigger at history insertion, kills the actual child process during the transaction, then checks another connection sees no partial result. The trigger/lock are removed only in the isolated test database. Production code has no crash switches or deliberate delays.

## D011 — Read-only real ladder and explicit provenance

Public ladder and activity exclude simulated personas; unranked activity remains owner-private. The existing legacy simulation column is mapped to the explicit ORM property isSimulated, preserving data without a destructive rename. No GET endpoint seeds or drifts simulated ratings. An explicit native insert-on-conflict seed is safe to repeat/concurrently invoke and never resets existing persona data. Real player rank uses a deterministic rating/hands/id ordering and is fetched independently of the paginated ladder, including profile refresh.

## D012 — revocable identity without resetting existing players

New sessions use hashed opaque random credentials stored in Postgres. Legacy HMAC sessions remain accepted for migration until the owner revokes them. Google subject, rather than email/name, keys provider identity; guest upgrade preserves the current Player ID. Cross-account histories are never merged implicitly. Google OAuth is optional until configured, and fixture tests never contact Google or spend Cloud bot credits. Administrator access requires a verified provider identity and an explicit server-side environment allowlist. Email magic-link integration and public registration gates remain unfinished.

## D013 — migration rehearsal is separate from live cutover

Only loopback elo_test import targets are supported until live cutover is explicitly prepared. A read-only local SQLite backup is a rehearsal source, not evidence of current production completeness. Legacy history retains IDs and values and is classified LEGACY; unsupported ranked live-room mappings cause refusal rather than silent loss. Restore verification uses a fresh isolated database and matching Postgres tools. The free Render Blueprint has no persistent disk and automatic deploys are off while storage cutover remains pending.

## D014 — approved game-rule and hand-record corrections

Reopening uses a player's last street action level and the last full raise, including cumulative short all-ins. Ranked blinds stay 10/20 for all ten hands, while other existing schedules remain unchanged. Human expiry checks when legal and folds only when facing a bet. Best seen means evaluated showdown hands including losses; best winning is separate, scored and never downgraded by a weaker result. Uncalled chips are refunds, not won pots. A lone fully matched player versus all-ins runs out immediately so an already uncontested side pot cannot be folded away.

## D015 — unique identity claims and ranked eligibility

Canonical new names use NFKC, collapsed whitespace and lowercase uniqueness with a database constraint. Old names/IDs are preserved and explicitly claimed by their owner. Reserved staff names and a basic explicit profanity list are filtered without claiming universal multilingual moderation. Ranked requires provider verification and a claimed name at the service boundary. Placement segregation reuses the existing 12-session provisional boundary and does not alter rating calculations. A separate atomic rankedPlacements counter starts at zero for legacy players so old house/legacy results do not bypass verified ranked placement.

## D016 — owner export and profile closure

Export is owner-only and excludes session credentials/other players' private cards. Explicit closure revokes access, removes provider contact data and pseudonymizes the current profile while retaining match/settlement history and historical snapshots for integrity. It cannot run during an active game. This is not represented as complete regulatory erasure; retention/legal policy remains deferred. Mutation rate limits persist hashed account/IP windows across restarts; public read-only ladder queries do not write limit records.

## D017 — ready checks and free-host lifecycle processing

Ranked proposals deal no cards until both players confirm within 15 seconds. Decline/expiry voids without ratings and preserves the other eligible player's queue priority. Both-absent void precedes single-player forfeit; 60 seconds offline or three consecutive missed decisions forfeits under the existing win/loss rating formula. Reconnect checks the elapsed absence before updating presence. An API-side Node worker processes persisted deadlines while the free host is running and catches up on wake; no paid worker or continuous availability guarantee is introduced.

## D018 — atomic game-command acknowledgements

A UUIDv4 key is bound to authenticated actor, scope and normalized intent. Game effects, quotas and the stored response commit together. Same-key/different-body requests conflict; known retries do not consume another quota. Action receipt retention is seven days and transient queue-poll retention is one minute. Browser pending keys are owner-scoped and survive unknown results/manual retry/same-tab reload; a fully received JSON response is required before acknowledging the intent. Identity-provider and session workflows retain their own security semantics.

## D019 — transactional room fanout and bounded replay

Room snapshots and notifications originate in the same Postgres transaction. Direct LISTEN connections feed shared room hubs, with personalized serialization before any frame leaves the server. Durable snapshots retain 24 hours and replay at most 128 contiguous events; gaps reset to current state. Streams rotate, authenticate again and use bounded buffers, preserving the latest state for slow viewers. Local 500-spectator acceptance is not a hosted capacity guarantee. Queue push remains WS9.

## D020 — require secure shuffle entropy

If platform cryptographic randomness is unavailable, creating a shuffle now fails explicitly. It no longer silently substitutes Math.random. This is an additional fairness defect found during WS8; the full client-commit/Merkle protocol remains a separate workstream.

## D021 — folded-card privacy and honest proof scope

Live serializers keep full shuffle seeds private after settlement, including historical event projection. Publicly revealing those seeds would expose folded cards. The live panel reports a commitment, not proof of fairness. Context-bound seed combination and salted Merkle membership utilities are prerequisites only until the exchange/archive/verification route is integrated. Private transcript replay and public disclosed-card membership are distinct capabilities; the latter cannot establish an unbiased full shuffle.

## D022 — sample tournament length, assert hand termination

A tournament can legitimately exceed 200 hands. The stress test keeps a bounded tournament sample and reports how many samples reached it, while preserving individual-hand termination, legality, burn/deal order, card uniqueness, chip conservation and stack checks. The independent deterministic 100,000-hand suite remains required. This changes test interpretation, not game/session rules.

## D023 — bounded seed preparation and selective hand archive

Both ranked confirmations still have 15 seconds; after confirmation, the frozen client seed exchange receives its own 15 seconds so a timely last confirmation can complete. Private preparation uses the same bounded exchange. Timeout aborts without a substitute seed or rated result. Browser seeds are pinned to the original server commitment and persisted per owner/room. New rooms use the protocol; old room states remain explicit legacy commitments without fabricated participants.

The hand archive transactionally stores separate public membership evidence and private replay input, rejects root replacement and freezes completed evidence. Public verification survives room expiry and reveals only public board/showdown cards. Trusted audit checks seed combination, root and actual deal/burn order. Public full-shuffle verification is unavailable under folded-card privacy, and the page explicitly limits the claim to membership. Integrity archives remain sensitive and retained under the existing closure policy pending a final legal retention policy.

## D024 — bounded searches and queue delivery

Ranked selection uses both players’ rating deviation, wait and pool. A three-minute cap makes the end of a search explicit. Recent pair cooldowns reduce repetitive matches, while a shared network remains a soft preference. The queue uses the existing Postgres listener for committed assignment notifications and rechecks its current state on reconnect.
