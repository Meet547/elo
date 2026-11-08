# Prototype deployment preparation

This branch is not deployed. Read docs/status.json and workstream notes before any release. The full hardening assignment is still underway; local checks are not a claim that hosted integrations or all product requirements are complete.

## Render backend

The root render.yaml now requests the free Node web service, with no paid disk or Render-managed database. It selects main for eventual release but disables automatic deployment while migration is pending. Do not sync it over the existing production service or merge storage changes into an automatically deploying branch before cutover preparation.

Provision a private prototype Neon Postgres project manually. Configure runtime DATABASE_URL and non-pooled DIRECT_DATABASE_URL in Render. Both must be Postgres URLs, use TLS for hosted connections, and remain backend secrets. Keep one backend instance while durable rate limits, realtime fanout and lifecycle work remain pending. A sleeping free web service cannot guarantee an always-on worker or continuous availability.

Render commands, from repository root:

```sh
npm ci --include=dev && npm run build:backend
npm run start:backend
```

Startup applies committed Postgres migrations and stops on migration/configuration failure before listening on provider PORT. Set NODE_VERSION=22, SESSION_SECRET and BACKEND_PROXY_SECRET to existing stable values where applicable. Preserving SESSION_SECRET is required for legacy-cookie migration compatibility. Current bot integration also requires backend OLLAMA_API_KEY; OLLAMA_MODEL defaults to gpt-oss:120b. Cloud practice removal and bot authorization changes remain WS11 work.

Set NEXT_PUBLIC_SITE_URL on the backend to the exact frontend origin for OAuth redirects. Google credentials and ADMIN_EMAILS are optional until the provider is configured; see AUTH_SETUP.md. Google credentials must stay server-only despite the shared public origin variable.

`/api/health/live` checks the running process without database work. `/api/health` checks database reachability and required completed schema migration; use it for Render health checks. Responses contain no player data. Other API routes require the proxy secret header.

## Vercel frontend

Use this repository's root, Next.js, Node 22 and the committed vercel.json install/build settings. Choose the reviewed branch deliberately; do not deploy the unfinished hardening branch as production by accident.

Set these in **Project → Settings → Environment Variables**:

- BACKEND_ORIGIN: backend HTTPS origin.
- BACKEND_PROXY_SECRET: exactly the backend's proxy secret; server-only.
- NEXT_PUBLIC_SITE_URL: the exact frontend HTTPS origin.

Redeploy after changes. Browser requests stay on the frontend origin; cookies are host-only and HttpOnly. OAuth redirects, cookies and SSE cross the server bridge. Never set Google client secret, session secret, database URLs, proxy secret or Ollama key in NEXT_PUBLIC-prefixed variables.

## Existing history and rollout

Do not point Postgres migrations at SQLite or delete/rebaseline existing history. Use MIGRATION_REHEARSAL.md. The local copy rehearsal preserves existing IDs/ratings/timestamps/history and verifies a fresh Postgres restore. It is not a current live export. Legacy ranked rooms still require explicit mapping before migration.

A staging rollout needs a current approved export, empty target, preserved secrets, hash/count verification, an agreed write freeze and rollback plan. Account for all writes after cutover before reverting traffic. This task has not performed a production import or changed hosted resources.

## Staging acceptance

Verify returning profiles across sleeping-host errors and backend restart; two-browser room actions and private-card boundaries; exactly-once ranked settlement and replay rejection; Google linking preserving the old player ID; cross-device restoration; individual logout and logout-all; migration readiness and backup restore. Do not treat the successful isolated fixtures as a live Google/Neon/Render acceptance run.

Google/Neon/email/Sentry accounts and staging are not yet configured. Optional email magic links, underage registration/consent launch surfaces, durable realtime and other remaining workstreams must be finished or explicitly deferred before a broader release.

References: [Render Blueprint fields](https://render.com/docs/blueprint-spec), [Render health checks](https://render.com/docs/health-checks), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

Backend startup now includes a deadline worker child process. Do not create a paid worker for the prototype. The internal endpoint is loopback-authenticated and is not available through the browser bridge. Free-service sleep still interrupts processing until wake. Game API clients and backend must be rolled out together because game mutation POSTs require Idempotency-Key. See workstreams/WS6.md.
