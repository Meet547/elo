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
backend/src/lib/            Database, signed sessions, rooms, queue, Ollama adapter
backend/src/proxy.ts        Authenticate calls from the Vercel API bridge
prisma/                    Schema and versioned SQLite migrations
scripts/                   Build preparation, server startup and verification
.github/workflows/ci.yml    Tests and both deployment builds
render.yaml                 Render service and persistent disk blueprint
vercel.json                 Vercel build configuration
```

The backend build generates `backend/.app` from backend source plus the shared
engine. It contains API routes only. Never edit or commit that generated directory.
The frontend contains no local database endpoints: every `/api/*` request streams
through the server-side bridge to Render. No Ollama key reaches browser code.

## Deploy

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Deploy Render first, then configure
Vercel with its HTTPS origin and matching proxy secret. Set your own Ollama Cloud
API key on Render. Hosts and paid services are not provisioned by a Git push.

## Local development

Use Node 22 and Bun 1.3.14. `npm ci` generates Prisma.
Copy `.env.example` to `.env.local` and fill the proxy/session secrets and Ollama key.

In a shell with these variables exported, initialize a development database:

```sh
mkdir -p db
export DATABASE_URL="file:$(pwd)/db/development.db"
touch db/development.db
bunx prisma migrate deploy
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
Human players have 20 seconds and automatically fold on expiry, including free-check turns.
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
node scripts/smoke-production.mjs
```

The smoke test uses a temporary database and two local production servers; it
never touches your development database or calls Ollama Cloud.
