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
