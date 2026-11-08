# WS2 — read-only public leaderboard

Implemented and verified locally; not deployed.

Leaderboard reads never seed players, invent matches, or change ratings. Simulated practice personas are excluded from the public ladder and feed. Public rows explicitly identify real-player provenance; private and legacy history is excluded from the ranked feed. Actor rank is calculated across all real players with deterministic tie breaks, independently of the top-60 page, and is retained by profile refreshes and the UI.

Practice personas have a separate explicit, idempotent `npm run db:seed` command. Concurrent seeds preserve existing persona ratings and history. The ORM now names the flag `isSimulated` while mapping to the existing database column, preserving legacy data without a destructive rename.

Three regression cases failed before the changes: a fresh GET wrote 34 players, concurrent reads raced, and a player below the first page had no actor rank. All pass after the correction. Additional tests cover repeated/concurrent seed preservation, simulated exclusion and private-history filtering.

Validation passed: typecheck, lint, complete unit suite, leaderboard integration, ranked replay integration, settlement process-kill recovery, both production builds and the two-service production smoke test against isolated Postgres.
