# WS4 — storage and operations

Partial implementation; no live migration or deployment has been performed.

The Postgres migration foundation is committed. A read-only SQLite backup tool opens the source in query-only mode, refuses overwrite and creates a private consistent backup. The import tool validates referential integrity, preserves Player/Session IDs, ratings, values and timestamps, labels old history LEGACY, and verifies normalized per-table SHA-256 hashes inside the import transaction. Existing target application rows cause a refusal. It currently permits only loopback elo_test databases; it cannot accidentally import into a remote production database.

The approved local source was backed up without modifying it. The rehearsal imported 47 players, 235 history rows, one waiting private room and no queue entries. A full pg_dump was restored into a separately created empty Postgres database. Every imported table's count and hash matched after restore. This is a local historical copy, not a current production export. The private backup is outside Git and no row data is included in this document.

Legacy ranked rooms are deliberately rejected until reviewed Match/participant/snapshot mappings exist. They are not dropped or silently rerated. The tested local copy contains no ranked room. Production import requires a current export and an explicit cutover process, not removal of this safety check.

The restore drill initially detected an incompatible local Postgres 14 client against the Postgres 16 fixture. It now uses the matching client inside the task-owned database container, with a local-client fallback for explicitly supplied fixtures. A separate synthetic fixture runs in CI; real player data is never uploaded to CI.

Integration commands connected to a shared CI Postgres service now create and remove their own elo_test_run database. A regression reproduced the old harness leaking the first command's fixture into the second. Successive commands now start empty and leave the shared base database untouched.

Health endpoints distinguish process liveness (`/api/health/live`) from readiness (`/api/health`). Readiness requires the committed schema migration to have completed and rejects an unfinished migration. A regression first caught the stale SQLite provider response; missing-migration and recovery cases now pass with Postgres.

The Render Blueprint requests the free plan, removes the paid disk and SQLite URL, uses explicit external Postgres credentials and disables automatic deployment pending cutover. It does not create or purchase external services. Keep the existing SESSION_SECRET during migration so legacy sessions can resume; changing it signs everyone out.

Remaining: external Neon setup, current approved production export, mapping any legacy ranked rooms, staging/cutover approval, monitoring configuration, deadline worker processing, runtime backups/restore scheduling and verified deployment. Sleeping free Render cannot guarantee an always-on worker or availability while asleep. There is no claim of a continuous-worker SLA.
