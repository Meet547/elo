# WS6 — ranked lifecycle, worker and command recovery

Implemented on the hardening branch and verified locally. Hosted cutover is not performed. A sleeping free host still cannot provide continuous availability; processing resumes when that host runs again.

## Readiness and queue release

Production matchmaking creates a PROPOSED match and a waiting room with a 15-second server deadline and no cards. Each matched player must confirm. Both confirmations atomically transition PROPOSED → READY → ACTIVE and start hand one. Partial readiness remains persisted without dealing. Decline or expiry transitions to VOID without ratings/history changes; the remaining/confirmed player's original queue timestamp is retained. Queue cancellation uses the same revision-checked decline path. The UI returns cancelled proposals to ranked and shows the confirmation state before cards are dealt. The old automatic activation constructor is confined to isolated crash-test fixture code.

## Presence, forfeit and void

Ranked participant presence persists in Postgres. Valid commands advance it atomically; connected reads refresh it at a bounded interval. Before accepting a reconnect, the server checks whether the previous absence already ended the match. This prevents the first person waking a sleeping host from turning a both-absent void into a win.

Both players absent for at least 60 seconds causes VOID before any single-player forfeit. One player offline for 60 seconds or missing three consecutive decisions forfeits. A valid action resets that player's missed-decision count. Automatic free checks count as missed decisions. An interrupted hand returns committed chips; fully awarded hands are counted once. Forfeit settlement uses the approved existing win/loss formula, records the actual completed hand count and advances placement once. Void records an audit settlement with no rating/history mutation. Terminal states release queue assignments.

## Actual worker process

`start:backend` starts a Node deadline worker alongside the API process, without purchasing a separate worker service. It calls only the loopback internal tick route every second, processes indexed due room deadlines in bounded batches, and sweeps expired queued presence, auth sessions, OAuth attempts, mutation limits and command receipts. Expired assigned matches are voided without changing ratings; historical rows are preserved. The launcher stops/restarts with its worker instead of silently serving without it.

The internal tick needs both the normal backend proxy gate and a separately derived worker HMAC. The browser bridge never forwards the worker header. No client can supply a clock, action, actor or game state to the tick endpoint. Logs use structured event names/counters without secret values or card data. Hosted monitoring and stronger capacity claims remain later/external work.

Free Render sleep stops processing while asleep. On wake, the first cycle handles already overdue absence/ready state rather than granting another full absence grace period. No always-on SLA is claimed.

## Command idempotency

Game POSTs for room creation, room commands and ranked queue commands require a client-generated UUIDv4 Idempotency-Key. The actor and scope bind the key; reusing it for a different normalized request returns a conflict. The result, game/queue changes, quota increments, settlement and history use one serializable unit of work. Retrying an acknowledged key returns the stored status/body without another action, room, settlement or quota charge. Timer work uses the same guarded game commits independently.

Action receipts retain results for seven days. Transient queue-poll receipts retain them for one minute; the worker sweeps both. Profile closure removes that actor's retained command receipts. Identity-provider state/nonce and profile-resume semantics remain separate identity workflows, rather than being treated as unauthenticated game-command credentials.

Browser automatic retries reuse one key and serialized body. Unknown results remain pending for manual retries and same-tab reloads, bounded to 100 owner-scoped intents. A complete JSON response is required to acknowledge an intent: headers plus a truncated body are not success. Explicit account changes partition pending intents by owner. An aborted UI request does not automatically issue another request. A later new, acknowledged user intent receives a fresh key.

## Clocks

Initial room reads supply a server timestamp. Countdown display uses the request midpoint to estimate clock offset; a five-minute client skew regression verifies both ready/action deadlines. The server's stored deadline always decides legality. Replayed older snapshots cannot replace a newer room revision.

## Evidence

Failing regressions preceded fixes for cards being dealt before confirmation, a 30-minute absence advancing only one ordinary action, duplicate room creation after a dropped response, manual retry losing its intent key, and a truncated response being treated as acknowledgement.

Passing tests cover confirmation/decline/timeout/cancel and queue priority; both-absent precedence; single offline/missed-decision forfeits; concurrent worker settlement once; reconnect precedence; TTL cleanup; worker authorization; 16 parallel receipt replays and payload mismatch rejection; quota replay invariance; and a full HTTP queue/ready/ten-hand/settlement pipeline. A real child process is SIGKILLed after its room write but before receipt insertion using a test-only Postgres trigger: room, quota and receipt all roll back; a restarted retry creates one room/result. Existing ranked settlement SIGKILL and 1,000 terminal replay tests also pass.

The production smoke launches the actual worker, closes all browser/SSE access to a room, waits for its deadline, and verifies a database revision advance before any room read. Both production builds, typecheck, lint, unit suite, migration/restore rehearsal and lifecycle integration checks pass locally. Hosted CI is checked after publishing this workstream.

Remaining: WS7 durable fanout/resume, WS8 selective fairness proofs, WS9 queue push/matchmaking, and the other recorded rating/product/abuse/accessibility work. This workstream does not claim those are implemented.
