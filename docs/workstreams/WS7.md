# WS7 — shared realtime room delivery

Implemented on the hardening branch, not deployed. Queue push delivery remains part of WS9.

A direct Postgres LISTEN connection per API process subscribes before reading room state. Transactional database triggers write a durable, revision-keyed RoomEvent and notify only after commit. A rolled-back room update publishes nothing. Notifications carry room identifiers/revisions, never hands or credentials. The event table contains private authoritative snapshots and is never exposed directly: every current/replayed frame passes through the same actor-specific public serializer. Events retain 24 hours; missing/older cursors receive a current snapshot rather than invented history.

Room hubs share refreshes, parsed state and per-seat/spectator serialized frames. Idle viewers no longer each poll the database. A five-second batched revision reconciliation handles lost notifications; ranked presence refreshes once per room/actor group. The direct listener reconnects and re-subscribes after connection loss. Stream cleanup releases observers, room timers and idle listener connections. Auth-session revocation and account closure close matching streams transactionally; reconnect always authenticates again.

Streams rotate after 23 seconds, send comment heartbeats, accept Last-Event-ID (or the browser reconnect cursor), and replay up to 128 contiguous retained events. Stream buffering is bounded to 64 KiB plus the latest live snapshot; slow readers may skip intermediate live snapshots and resume from durable revisions. Replay waits for reader capacity. The browser closes failed EventSources before retrying with capped exponential backoff, preserves its last received revision and cleans up retry timers on navigation. This does not claim a continuous free-host availability guarantee.

## Local evidence

- Baseline failing regression: nine idle viewers produced 27 individual room reads in 1.05 seconds. Shared delivery now performs one or two room reads during the same observation interval.
- `npm run test:realtime`: all six seats plus spectators see only their own permitted cards; no deck/hidden seed; rollback publishes nothing; ordered revision replay; live revocation; actual Postgres listener termination/recovery; deleted-room cache invalidation; 1,000 synthetic slow-reader updates retain a bounded queue (208 frames) and deliver the latest snapshot.
- `npm run typecheck`, `npm run lint`, frontend and backend production builds passed.
- `npm run smoke:production` passed with the real worker, two HTTP services, durable identity/state after restart and private-card/proxy/CSRF boundaries.
- `K6_BINARY=/path/to/k6 npm run test:spectator-load`: 500 simultaneous local HTTP SSE spectators; all 500 received one real HTTP fold action, p95 action-to-event **148.04 ms**, max 159 ms, 0% spectator failures. Backend and Postgres ran locally; no production services/data or paid load infrastructure were used. This is a local fanout result, not evidence of free Render/Vercel capacity or a sustained/multi-room throughput guarantee.

The reproducible load fixture creates its own loopback database and requires an explicit local k6 binary. k6 2.3.0 resolved the community SSE extension 0.2.0. It waits for all 500 first snapshots before timing the action; extension setup/download time is excluded from the synthetic fixture's decision clock. The first run correctly failed the HTTP-action assertion when extension download consumed that clock; it was not counted as a successful action benchmark.

## Provider requirements

Use an unpooled direct Postgres URL for LISTEN, migrations and export/restore. The normal runtime Prisma connection may use the provider's pooled URL. PostgreSQL delivers NOTIFY after commit, and LISTEN requires a session connection. Sources: [PostgreSQL NOTIFY](https://www.postgresql.org/docs/16/sql-notify.html), [PostgreSQL LISTEN](https://www.postgresql.org/docs/16/sql-listen.html), [node-postgres Client](https://node-postgres.com/apis/client), [Neon connection pooling](https://github.com/neondatabase/website/blob/main/content/docs/connect/connection-pooling.md), [k6 SSE extension](https://github.com/phymbert/xk6-sse).
