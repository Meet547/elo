# WS1 — ranked integrity

Status: implemented and verified locally on the hardening branch; not deployed. Continuous lifecycle processing, player-confirmed readiness, forfeits/void policy, authentication changes and legacy-data import remain in their named later workstreams.

## Intentional changes

- Removed the legacy client-described house rating mutation and its environment switch, including the practice store request. Practice still shows an unrated receipt with unchanged rating.
- Finished/closed rooms reject player commands with a non-mutating conflict response, including joins by existing members.
- New ranked matches have explicit QUEUED/PROPOSED/READY/ACTIVE/SETTLING/SETTLED/VOID/FORFEIT phases. Every implemented phase change is conditional on its prior phase and creates a transition record. Automatic readiness is retained only as compatibility until WS6 adds confirmation.
- Match identity, frozen pre-match rating snapshot, a unique match settlement and unique match/player history are now persisted. New rated results require a match identity.
- Player rating/statistics, both history rows, the settlement record, terminal room revision and queue release commit together. Stale room writes roll back the match claim as well.
- Candidate assignment uses serializable isolation rather than relying on SQLite's process-wide write locking.

## Red/green evidence

Before the correction, `scripts/test-ranked-replay.ts` completed the reviewed ten-hand fixture and failed its first replay assertion: rated count was 2 instead of 1 after the repeated join. This failure was captured before the implementation.

After the correction the same fixture passes, followed by 1,000 mixed terminal commands in parallel batches, with current/stale revisions and both members. Rating/rated count, history count, settlement count and room revision stay unchanged. Direct duplicate history and settlement inserts are rejected by database unique constraints. Invalid/backwards phase changes and stale phase claims are rejected.

`scripts/test-settlement-crash.ts` pauses the actual settlement in a test-only Postgres trigger after a Player update, checks that another connection cannot see the uncommitted rating, SIGKILLs the child process, and verifies no history/settlement/phase/room-revision partial write is visible. A restarted reader settles once. There are no crash switches in production application code.

## Checks

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:ranked-integrity`
- `npm run test:settlement-crash`
- Frontend and backend production builds
- `npm run smoke:production` against isolated Postgres, including persistence across restart

All passed locally. The first engine baseline failure and unchanged passing rerun remain documented in discovery; the arbitrary tournament cap will be addressed in WS5/WS13, not silently removed here.

## Migration boundaries

Apply the committed Postgres migrations only to isolated/staging targets until import and rollout approval. Old history keeps nullable match identity with LEGACY mode; new ranked rows require identity and use RANKED mode. Legacy active rooms must receive explicit match identity/participant mapping in the import tool before being resumed. This branch does not attempt to mutate the existing live SQLite database.
