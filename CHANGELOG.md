# Changelog

## Unreleased — production-hardening branch

- Phase 0: reverified the review and additional issues against main 381e466, including fresh isolated settlement-replay and concurrent-seeding reproductions.
- Preserved the review/evidence in the repository and converted local source links to repository-relative links.
- Recorded the work plan, approved prototype choices, external gates, migration/rollback strategy and verification limits.
- No application behavior or production deployment changed in the discovery commit.

- WS4 prerequisite: active Prisma schema/startup now target Postgres; SQLite history retained as an import/rollback reference. Local integration/smoke tests use isolated Postgres and refuse remote/production targets. Existing live deployments are unchanged.

- WS1: removed client-described house rating mutations and their switch. Practice receipts retain unchanged ratings. Finished-room commands now reject without mutation. New ranked matches have conditional lifecycle states, a unique settlement, unique match/player history and atomic rating/history/settlement writes.
- Ready confirmation UI remains WS6 work; automatic match startup is retained until that workstream. Existing legacy room/history import mapping remains part of the approved migration rehearsal.

- WS2: real leaderboard reads no longer seed/simulate games or mutate the database. Simulated practice personas are explicitly marked and seeded idempotently only by operator command. Public ranked activity excludes simulated and private results. The signed-in player's rank is computed independently of the top-60 page and rendered in Shell/Profile after identity refresh.

### WS3 — returning-player recovery

- Retry safe profile resume through sleeping-host failures; show a reconnect screen after timeout instead of treating the player as anonymous.
- Coalesce duplicate boot requests and preserve the existing signed identity on repeated claims, in both client and server.
- Added outage/recovery boundary and identity-preservation regression coverage. Provider-backed identity remains an open workstream.

### WS3 — revocable sessions and Google integration

- Added persistent opaque sessions, individual logout and logout-all with legacy-cookie revocation.
- Added Google authorization-code flow with PKCE, browser-bound single-use state, nonce and verified ID tokens; guest upgrades preserve player IDs and history.
- Added verified administrator email allowlist, private account status, profile connection controls and same-origin OAuth redirects.
- Added local signed-token/security-boundary and Postgres session/linking tests. Live provider setup, email recovery, account management and ranked verification gates remain pending.

### WS4 — local migration and free-host preparation

- Added private read-only SQLite backup, guarded import, count/hash validation and fresh Postgres restore rehearsal.
- Rehearsed the approved local history copy: 47 players, 235 history rows and one private room preserved exactly.
- Isolated shared-CI test commands into separate databases; added a regression for fixture leakage.
- Split liveness/readiness and require a completed schema migration. Updated Render Blueprint for free external-Postgres hosting with automatic deployment off pending cutover.

### WS5 — betting, deadlines and hand records

- Corrected street-local reopening after short/cumulative all-ins; fixed ranked blinds at 10/20 for ten hands.
- Changed human timeout to check when legal, otherwise fold, in live and practice.
- Separated scored best-seen/best-winning records and persisted ranked descriptions/scores.
- Fixed a newly reproduced side-pot chip-loss path and excluded uncalled refunds from pot-win records.
- Added independent pot/odd-chip cases and 100,000 seeded hand invariants with exact replay checks.

- Google sign-in is also available directly from onboarding when configured, allowing cross-device recovery without creating an extra guest profile. Public capability responses expose only availability, never credentials.

### WS3 continuation — identity controls

- Added canonical unique names with race-safe conflict responses, legacy name claims and profile rename controls.
- Persisted atomic account/IP mutation limits across restarts using hashed keys; public ladder reads remain database read-only.
- Added owner-only export and explicit profile closure, with credential revocation and retained integrity history; active games prevent closure.
- Enforced provider verification and claimed names inside matchmaking, with separate pools using the existing 12-session provisional boundary.

### WS6 — lifecycle and command recovery

- Added card-free 15-second ready checks, decline/timeout voids and queue-priority restoration.
- Added persisted presence, three-miss/60-second forfeits, both-absent void precedence and reconnect protection.
- Started an authenticated loopback deadline worker with backend startup and bounded TTL cleanup on the free web service.
- Added atomic game-command receipts, actor/payload key binding, quota-safe replay and persistent browser pending intent keys.
- Added measured server-clock countdowns, forfeit/void presentation and process-kill/drop/truncation/replay regressions.
