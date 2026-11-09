# Deploy, restore and respond

## Release

Follow [deployment setup](DEPLOYMENT.md) for the Render backend, Vercel frontend and PostgreSQL connection. Use the same repository for both services. Set the same `BACKEND_PROXY_SECRET` in Vercel and Render. The Vercel server needs `BACKEND_ORIGIN` and the public site URL. Keep PostgreSQL connection strings and `SESSION_SECRET` on Render. The worker and PostgreSQL listener need an unpooled direct URL. Configure Google using [auth setup](AUTH_SETUP.md).

A reviewed rollout needs a known source revision, a verified production export and an isolated staging restore. Pause writes during the migration window and compare source/target counts and history hashes. Keep the existing cookie signing secret during cutover to retain legacy identities. Deploy the backend with its committed schema, verify readiness, then connect the frontend. Test sign-in, resume, a private room and a ranked settlement. Check the production branch’s CI after the approved merge.

## Backup and rollback

Protect exports and Postgres dumps as private data. They contain player records and private hand-audit inputs. Use a consistent SQLite backup for the legacy source. Use a PostgreSQL-compatible `pg_dump` custom-format backup for Postgres. Keep separate copies of the application revision, schema migration state and deployment configuration. Test each restore into a fresh isolated database before changing the active deployment. See the [migration rehearsal](MIGRATION_REHEARSAL.md).

Before cutover, rollback keeps the legacy database and previous deploy artifact available. After a Postgres release, roll back to a compatible application revision where possible. To restore a database after writes have occurred, put the service in maintenance first and account for new sessions and rating adjustments. Restoring an older snapshot alone loses subsequent writes.

## Operational checks

- For startup failures, compare the frontend backend origin, proxy credential and the backend’s readiness response. A live process can still be unready if its migration state is behind.
- For a stalled room, check the worker and the persisted deadline. Clients can reconnect by revision. The free backend may sleep and processing resumes when it wakes.
- For missed realtime updates, check the unpooled listener connection. Queue reconnect reads current assignment. Room reconnect replays retained revisions.
- For rating drift, review the daily snapshot and the structured `rating_drift` log. Compare settlement and moderation ledgers. Record the reason for corrections through the admin tool.
- For disputed cards, review the public disclosure proof and authorized private audit. Keep seed transcripts and undisclosed positions in restricted storage.

Provider credentials, live export, actual staging and production cutover require owner access. Approved legal notices and parental-consent handling are separate launch work.
