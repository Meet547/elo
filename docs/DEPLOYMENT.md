# Vercel frontend + Render backend

## 1. Render

Create a Blueprint from this repository, branch `Updated-frontend`, using the
root `render.yaml`. The Starter web service has one persistent disk mounted at
`/var/data`; its database is `file:/var/data/elo.db`. This configuration requires
paid Render compute/disk resources. Keep exactly one service instance: the SQLite
write lock, in-memory request limits, and Cloud concurrency budget assume one process.

Render installs the locked dependencies and builds the API-only Next application.
Startup refuses missing production secrets, applies committed migrations with
`prisma migrate deploy`, then listens on Render's `PORT` on `0.0.0.0`.
The liveness/readiness endpoint is `/api/health` (200 when the database is reachable).
All other endpoints require the secret header set by the Vercel bridge.

Set `OLLAMA_API_KEY` to your own key from https://ollama.com/settings/keys.
`OLLAMA_MODEL` defaults to `gpt-oss:120b`; choose an available model from
https://ollama.com/api/tags when changing it. The adapter uses
`https://ollama.com/api/chat`, bearer authentication, non-streaming JSON replies,
prompted JSON parsed and validated locally (Cloud does not support the local API’s
structured-output `format` option), an 8 second timeout, four concurrent requests, and a process-wide request budget.
[Ollama Cloud does not support structured-output enforcement](https://docs.ollama.com/capabilities/structured-outputs); the adapter validates the prompted JSON locally.
Ollama failures never become illegal poker actions or block the practice table.
No real Cloud call is included in CI, so verify the key/model with one practice hand.

Render generates `SESSION_SECRET` and `BACKEND_PROXY_SECRET`. Preserve the signing
secret across redeploys; rotating it signs existing profiles out. Copy the proxy
secret into Vercel. Never put either secret or the Ollama key in a NEXT_PUBLIC variable.

## 2. Vercel

Import this GitHub repository and select `Updated-frontend`. Root Directory is the
repository root. Framework: Next.js. The committed `vercel.json` provides install
and build commands. Use Node 22.

Set server environment variables for each Vercel environment that should connect:

- `BACKEND_ORIGIN`: Render HTTPS origin, for example `https://elo-backend.onrender.com`.
- `BACKEND_PROXY_SECRET`: exactly the Render value.
- `NEXT_PUBLIC_SITE_URL`: the canonical public frontend HTTPS origin.

Redeploy after editing environment variables. The proxy forwards signed HttpOnly
cookies and SSE without buffering. Cookies remain host-only on the frontend;
there is no cross-origin browser login, CORS allow-all, or localStorage token.
Mutation requests from another browser Origin are rejected. The Render proxy gate
rejects direct calls that lack the shared secret, including forged Cloud requests.
Do not publicly expose that secret in monitoring screenshots or logs.

## 3. Release checks

1. Check Render `/api/health` returns 200.
2. Claim a profile on Vercel; reload and confirm it resumes.
3. Create a six-character private room. Open the invite in another browser profile,
   claim a second player, join, start, and confirm both see the same moves.
4. Queue two profiles for ranked play. Confirm exactly ten hands, score updates,
   and one saved result each. House games cannot submit ranked results.
5. Play a practice hand with Render's Ollama key configured. Disconnect Cloud and
   confirm play continues through the heuristic fallback.
6. Redeploy Render and confirm profiles/history persist and sessions remain signed in.

## Data, identity and operation

This is browser-based play-money identity, not email/password accounts. Clearing
cookies loses access to that profile. There are no deposits, payments, or prizes.
Ranked actions, private cards and rating settlement are server authoritative;
practice remains a client-side, unranked simulation and its claimed results cannot
change ranked ratings.

SQLite is appropriate for the initial single-instance deployment. Back up the
persistent disk/database regularly with a consistent SQLite backup, test restore,
and monitor health, error rates, disk usage, and Cloud usage. Disk-backed deploys
can interrupt SSE connections; clients reconnect automatically to persisted state.
For multiple instances, migrate the schema to managed PostgreSQL and move request
limits/concurrency budgets to a shared store before scaling out.

Fresh installs apply the initial migration automatically. For an existing database
that already has this schema, back it up, verify its schema matches the committed
migration, and baseline it once with `prisma migrate resolve --applied
20261108000000_initial` before starting. Never reset a production database or use
`db push --accept-data-loss` during a deploy.

Secrets, local player databases, logs, generated builds and copied attachments
are excluded from the publishing commit. If a secret was previously shared outside
this project, rotate it in the host dashboard.
