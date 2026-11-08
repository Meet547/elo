# Elo

A play-money Hold’em app with house practice, private rooms, and ten-hand ranked
matches. Vercel serves the interface; a single Render service owns sessions,
matchmaking, live game state, ratings, persistence, and Ollama Cloud requests.

## Structure

```
src/app/                    Vercel pages and same-origin API bridge
src/components/             Shared site layout, poker UI, profile and room inputs
src/store/                  Client practice game driver and interface state
src/lib/poker/              Shared engine, evaluator, fairness and legal moves
src/lib/server/             Vercel-to-Render streaming API proxy
backend/src/app/api/        Render API endpoints
backend/src/lib/            Database, revocable sessions, Google linking, rooms, queue, Ollama
backend/src/proxy.ts        Authenticate calls from the Vercel API bridge
prisma/                    Postgres schema/migrations and archived SQLite schema
scripts/                   Build preparation, server startup and verification
.github/workflows/ci.yml    Tests and both deployment builds
render.yaml                 Free Render service with external Postgres configuration
vercel.json                 Vercel build configuration
```

The backend build generates `backend/.app` from backend source plus the shared
engine. It contains API routes only. Never edit or commit that generated directory.
The frontend contains no local database endpoints: every `/api/*` request streams
through the server-side bridge to Render. No Ollama key reaches browser code.

## Deploy

This hardening branch is not deployed and still has open workstreams in [docs/status.json](docs/status.json). Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for staging preparation. Configure Render first, then configure
Vercel with its HTTPS origin and matching proxy secret. Set your own Ollama Cloud
API key on Render. Hosts and paid services are not provisioned by a Git push.

## Local development

Use Node 22 and Bun 1.3.14. `npm ci` generates Prisma.
Copy `.env.example` to `.env.local` and fill the proxy/session secrets and Ollama key.

In a shell with these variables exported, initialize a development database:

```sh
export DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/elo_development"
export DIRECT_DATABASE_URL="$DATABASE_URL"
npm run db:deploy
npm run dev:backend
```

In a second shell with the same proxy secret and `BACKEND_ORIGIN=http://127.0.0.1:4000`:

```sh
npm run dev
```

Open http://localhost:3000. The browser always calls the frontend origin.
Practice bots request Ollama decisions using only their own hole cards, public
board, and legal betting bounds. Invalid output, rate limits, missing credentials,
and the 8-second Cloud timeout use the local heuristic. If no decision reaches the
browser within 10 seconds, the bot folds. Practice never changes ranked ratings.
Human players have 20 seconds and automatically check on expiry when checking is free, otherwise fold.
The default Cloud model is GPT-OSS 120B with low reasoning effort.

Live acceptance checks (require your own key; these are not run by CI):

```sh
OLLAMA_API_KEY=your-key bun scripts/test-ollama-live.ts
```

See `docs/validation/ollama-bots.json` for the recorded 34-persona, 136-decision
acceptance run. These controlled situations do not prove optimal poker play.

## Verify

```sh
npm run lint
npm run test
npm run build
npm run build:backend
npm run test:integration
npm run test:account-sessions
npm run test:google-auth
npm run test:session-resume
npm run test:leaderboard
npm run test:ranked-integrity
npm run test:settlement-crash
npm run test:legacy-import
npm run smoke:production
```

The smoke test uses a temporary database and two local production servers; it
never touches your development database or calls Ollama Cloud.

Existing SQLite history is preserved through the guarded [migration rehearsal](docs/MIGRATION_REHEARSAL.md), not by applying Postgres migrations to SQLite. Google configuration and live acceptance are described in [AUTH_SETUP.md](docs/AUTH_SETUP.md). Provider accounts, live export, staging/cutover and the remaining workstreams are still pending.

Ranked requires a verified provider and claimed unique name. Both opponents confirm a 15-second ready check before any deal. Three consecutive missed decisions or 60 seconds offline forfeits; both absent voids with unchanged ratings. Countdown display adjusts to server time.

Production backend startup includes the deadline worker. For local development with the API already running on 4000, use a third shell with the backend variables exported and run `PORT=4000 npm run worker`. Do not start an extra manual worker in the production web service. Free-host sleep still suspends processing; see [WS6](docs/workstreams/WS6.md).

Game mutation POSTs require a UUIDv4 `Idempotency-Key`; the frontend helper manages keys and retrying unknown responses. See WS6 for receipt retention and exact transaction boundaries.
