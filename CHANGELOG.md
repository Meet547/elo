# Changelog

## Unreleased — production-hardening branch

- Phase 0: reverified the review and additional issues against main 381e466, including fresh isolated settlement-replay and concurrent-seeding reproductions.
- Preserved the review/evidence in the repository and converted local source links to repository-relative links.
- Recorded the work plan, approved prototype choices, external gates, migration/rollback strategy and verification limits.
- No application behavior or production deployment changed in the discovery commit.

- WS4 prerequisite: active Prisma schema/startup now target Postgres; SQLite history retained as an import/rollback reference. Local integration/smoke tests use isolated Postgres and refuse remote/production targets. Existing live deployments are unchanged.
