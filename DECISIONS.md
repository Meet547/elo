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
