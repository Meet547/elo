**Elo: codebase, backend boundaries, and page-flow review**

Reviewed 8 November 2026 against commit `381e466`. This document describes the current implementation, including defects; it does not describe an idealized future version. Review artifacts are local. Application source and deployment settings were not changed during this review.

The principal architecture is sensible: real multiplayer decisions and ranked outcomes are owned by the Render API, while practice is a browser simulation. However, the completed-match settlement path can be replayed. That defect should be resolved before promoting the ranked ladder as trustworthy. Free-host database durability is a separate launch limitation.

**1. What was reviewed and how**

The review traced the Next.js pages, eight view components, Zustand driver, complete API surface, session and proxy gates, Prisma schema, live-room and ranked transactions, shared engine and evaluator, bot requests, rating model, profile chart, and deployment/startup scripts. Generated backend files, third-party UI primitives, and assets were distinguished from maintained application logic. The repository has 248 tracked files; this is an application-logic review, not a claim of a line-by-line audit of every SVG and third-party-style component.

Runtime-sensitive findings were checked using isolated processes and a separate SQLite database on localhost port 4401. A real local ranked match was played through all ten hands before testing settlement replay. No production account or rating was modified for that test. Additional offline checks exercised betting bounds, startup identity recovery, and request-driven timeout progression. The deployed Render configuration was read without exposing secrets. Earlier live integration smoke results and the latest passing CI were supporting evidence, not proof of exhaustive correctness.

Evidence: [isolated results](2026-11-08-evidence.json). Existing passing CI: [run 42464272262](https://github.com/Meet547/elo/actions/runs/42464272262). No browser visual audit or load test was performed in this review.

**2. The three execution layers**

There are three layers, even though the project is usually described as frontend/backend:

- **Browser:** React views, Zustand, card/chip presentation, sounds, interactions, practice engine, practice decision clocks, and display calculations. Browser state can be inspected and edited by its user.
- **Vercel server:** Next.js routing/metadata and `/api/[...path]`. Its server-side bridge validates mutation origins, limits request bodies, forwards cookies, adds the shared proxy secret, and streams the Render response. That bridge is backend code deployed with the frontend; it is not browser code.
- **Render server:** authenticated API, multiplayer engine execution, room revisions, queues, ratings, database writes, and Ollama credentials/inference. SQLite is accessed through Prisma.

Requests follow `browser → same-origin Vercel /api → Render /api → Prisma/SQLite or Ollama`. The browser does not need a Render API key or cross-origin Render cookies. The Ollama key and shared proxy secret stay in server environments. `NEXT_PUBLIC_SITE_URL` is the intentionally public canonical origin.

Maintained frontend source is `src/app`, `src/components`, and `src/store`. Maintained backend source is `backend/src`. Shared algorithms live in `src/lib/poker` and `src/lib/rating.ts`. `scripts/prepare-backend.mjs` builds the ignored `backend/.app` directory by copying maintained source; generated files there are not a second source of truth.

**3. Real pages and navigation**

There are four primary page patterns:

- `/`: chooses Onboard, Lobby, practice Table, practice Settlement, or Profile from `useFelt().view`.
- `/ranked`: authenticated matchmaking screen. `/ranked?queue=1` automatically joins the queue, then normalizes the URL; a match redirects to `/live/CODE`.
- `/live`: authenticated create/join-room lobby.
- `/live/[code]`: waiting room, active private or ranked game, and final multiplayer receipt.

Profile, practice table, and practice receipt do **not** have separate URLs. They are views inside `/`. Refreshing does not restore an in-progress practice hand or the currently selected root view. The session cookie can restore the player and return them to the lobby. A literal `/profile` or `/table` route does not exist.

`Shell.tsx` supplies desktop/mobile navigation around Lobby, Profile, and the Ranked/Live lobbies. Practice tables hide the normal shell navigation. Active multiplayer rooms use their own table header and Lobby link rather than the normal sidebar.

Source: [root page](../../src/app/page.tsx:14), [Shell](../../src/components/views/Shell.tsx:67), [Ranked](../../src/components/views/Ranked.tsx:23), [Live entry](../../src/components/views/LiveRoom.tsx:30).

**4. Feature ownership and persistence**

- **Claim Seat:** frontend form and startup progress; backend creates a Player and signs an HttpOnly session cookie. The name is a display name, not a password-protected account.
- **Lobby:** frontend search, filtering, offer presentation, and navigation. `/api/leaderboard` supplies ratings/activity, but also seeds and simulates bot activity on the server.
- **House/practice game:** browser owns the entire deck, seats, betting progression, timers, and receipt. The backend supplies optional Ollama decisions. Practice results are not saved to the official ledger with the deployed default settings.
- **Profile:** backend supplies Player and the latest 60 Session rows. Browser derives graphs, filters, percentages, and placement summaries. This is the signed-in player's profile, not a public arbitrary-player profile endpoint.
- **Ranked matchmaking:** browser polls; backend owns candidate selection and assignments in a transaction. The browser does not choose its rated opponent or submit the official winner.
- **Private live rooms:** frontend renders public snapshots and sends commands; backend owns the deck, legal actions, clocks, pot awards, and serialized room. They are unranked, and their results currently do not create Session rows or update Player totals.
- **Ranked games:** backend owns ten-hand scores and attempts terminal rating/history settlement in the same transaction as the winning room revision. The replay flaw in section 10 prevents treating this as fully idempotent today.
- **Card previews, typography, animation, chip geometry, sound, receipt animation, graph scrub and pull gesture:** frontend presentation. These do not change server state except graph refresh, which requests history/profile.
- **Local preferences:** `felt_muted` and recent practice-opponent slugs live in localStorage. Despite the name, the store's `token` contains a player ID, not the authentication credential.

The older browser-demo functions in `src/lib/demo.ts` are still imported into the store, but current boot/profile creation and fallback settlement do not call them. Their existence does not provide a working offline identity or durable practice history.

**5. User flows, including their actual branches**

**First visit and returning player.** `/` or a protected entry calls `boot()` → GET `/api/profile`. A valid signed session loads the profile; no session presents Claim Seat. Claim Seat calls `waitForRoomReady()` → safe GET `/api/health` polling for up to 120 seconds → one POST `/api/profile` → cookie + Player → root Lobby, or continuation of the current Ranked/Live entry. A failed initial resume is currently treated like no session; section 10 explains the identity risk.

**Practice.** Lobby or Profile empty-state action → client-generated offer → one human and five roster bots → shuffle/deal → local betting driver. Human commands run `applyAction()` locally. Each bot requests `/api/bots/decide`, with a validated heuristic fallback when appropriate. A bust can end practice immediately. A funded player must complete ten hands before cashing out; an active hand finishes before a queued cash-out. The receipt is a root view. POST `the legacy house-rating endpoint` normally returns 403 because practice ratings are disabled; the UI then shows an unchanged-rating receipt without saving a Session. Play Again creates another local practice session; Profile loads the official ledger, not that receipt.

**Private multiplayer.** `/live` → POST `/api/live` → random six-character A–Z/0–9 code → `/live/CODE` waiting room → share link → another authenticated player opens it and claims a seat. Checking a code opens the room; it does not itself join the seat. Host starts only with 2–6 players → backend deals → viewers subscribe to personalized SSE snapshots → actor POSTs command with current revision → legal action and revision validated → room persisted → subscribers receive new snapshots. A 409 returns the newer room for recovery. Players can leave a waiting room; there is no implemented in-game leave/forfeit command. Play continues until one player remains funded, then shows a private receipt. No official history write occurs.

**Ranked.** `/ranked` → POST join → searching → browser poll every 1.5 seconds. Initial allowed rating gap is ±75; it grows by 25 each ten seconds to ±350, and both players must accept the gap. Stale unmatched seats are excluded after 45 seconds. The closest compatible rating is selected, then waiting time/ID break ties. A transaction creates a two-player ranked room and assigns both queue seats → redirect `/live/CODE` → automatic match start. Exactly ten hands use fresh 1,500-chip stacks per hand. The server sums hand profits; higher total wins, equal totals draw. After the tenth hand, terminal room state, rating updates, history rows, and queue cleanup commit transactionally. Receipt → next ranked search or private lobby.

**Profile.** Shell Profile action → root `view=profile` → parallel GET history and profile → reverse newest-first history for graph → prepend the oldest fetched `ratingBefore` → select/scrub real readings. Chart windows are the latest 10 sessions, 30 sessions, or all **loaded** sessions, not hourly financial intervals. Value, change, and percent share the same selected series. Pull crossing the threshold arms refresh; release runs the history/profile refresh. The 60-row history cap limits the apparent lifetime graph.

**6. API contract inventory**

Every browser endpoint below is on the Vercel origin and is forwarded to the same path on Render. All Render API routes except health require the shared proxy header.

- `GET /api/health`: checks database reachability; no player session required.
- `GET /api/profile`: resumes the signed player; 401 for absent/invalid identity or missing Player.
- `POST /api/profile`: sanitizes/truncates display name to 18 characters, creates Player, issues session. No existing account login, rename, recovery, or logout workflow.
- `GET /api/leaderboard`: top 60 players and 14 recent sessions, plus current-player data only if they appear in that top-60 result. Also mutates seeded/simulated rival data.
- `GET /api/history`: signed player's latest 60 sessions.
- `POST /api/ranked`: `join`, `poll`, or `cancel`; authenticated, transactional queue control. A matched seat is returned before cancellation handling, so cancel does not abandon a matched game.
- `POST /api/live`: authenticated private-room creation.
- `GET /api/live/:code`: personalized room snapshot. A signed nonmember can watch a private-code room; ranked nonmembers are rejected.
- `POST /api/live/:code`: `{revision, command}` where command is join/leave/start/act. Session determines actor; server checks host, turn, deadline, legal bounds, and compare-and-swap revision.
- `GET /api/live/:code/events`: authenticated personalized SSE. Internally re-reads roughly every 450 ms, emits changed revisions, and closes after about 23 seconds so EventSource reconnects. It is not WebSocket or Redis pub/sub.
- `POST /api/bots/decide`: authenticated practice inference; validates client-provided visible situation and resulting action. Does not load an authoritative practice hand from the database.
- `The legacy house-rating endpoint`: legacy client-described house settlement, disabled unless `the legacy practice-rating switch`. Keep it disabled in production.
- `GET /api`: greeting only; not a readiness check.

**7. Poker engine, bots, and ratings**

The shared engine controls button rotation, blinds, two-round dealing, burns, street progression, checks/calls/raises/folds, all-ins, side pots, split pots, and awards. All chips are integers. Initial blinds are 10/20 and increase every eight hands. The evaluator chooses the best five cards from five, six, or seven cards; numeric scores order hand categories and kickers, including the ace-low straight. Winner text is a separate compact formatter, so display labels do not decide the pot.

The shuffle uses a fresh platform-random 32-byte seed, ChaCha20 stream, rejection-sampled Fisher–Yates, and SHA-256 commitment. The hand-end seed reproduces the whole deck. This proves consistency with the published commitment; it does not independently prove that a server did not select a favorable seed before publishing it. Server live snapshots hide the seed and opponents' holes while betting. Seed disclosure has a post-hand privacy consequence noted below.

There are 34 roster personas, all using the configured model (`gpt-oss:120b` currently), not 34 different models. The backend sends own cards, public board, legal bounds, persona, made hand, a 128-sample equity estimate against random unknown hands, pot odds, and stack-to-pot ratio. Actual opponent holes/deck are excluded. The model reasons at low effort and returns JSON; the adapter validates it. Production startup nevertheless requires a nonempty Ollama key, even though the decision adapter has a missing-key fallback. This is a bounded LLM-assisted heuristic player, not a solved poker strategy or proven optimal opponent-range model.

Budgets are 8 seconds for Cloud, 10 seconds for the browser's bot request, and 20 seconds for a human decision. Backend Cloud failures may produce a heuristic action before the deadline; a browser request deadline folds the bot. Humans auto-fold even when a free check exists. Live initial dealing adds 950 ms before the first decision deadline. Browser practice clocks can be paused/throttled with the tab and should not be considered server-enforced competition clocks.

Ranked updates use adapted Glicko-2: initial rating 1200, RD 110, volatility 0.06, provisional status for 12 rated sessions, a minimum RD of 55, and a soft change limit according to experience/rating. Placement determines win/loss/draw; ten-hand chip profit determines placement. The margin itself is not multiplied into the rating award. Independent updates are not promised to be a zero-sum point transfer. Ranked `Session.finalStack` describes the last hand's stack, while `Session.net` is the aggregate ten-hand profit; downstream reports must preserve that distinction.

**8. Data model and operational behavior**

`Player` stores identity and aggregate rating/statistics. `Session` stores one history result per player; it has no room/match foreign key or uniqueness constraint tying a result to a match. `LiveRoom` stores the entire authoritative table as a JSON string, a revision, and expiry. `RankedSeat` stores one queue assignment per player, its rating and presence timestamps. SQLite serializes writes; room revisions prevent stale competing updates. The whole-room JSON approach is straightforward but gives no separate per-action audit table or easy history reconstruction after room deletion.

Rooms start with a 24-hour expiry and successful commits refresh it. Expired room cleanup runs opportunistically during private room creation. It is not a background scheduler. Live clocks also advance on room reads/commands, including SSE's re-reads. If every client disconnects, no independent worker completes the match; one later read advances only one due step and schedules subsequent work from that read time.

Observed deployment: Render Web Service, `main`, free plan, Singapore, one instance, Node 22, SQLite `file:/tmp/elo.db`, Cloud model `gpt-oss:120b`. The committed `render.yaml` instead describes paid Starter, `/var/data/elo.db`, a disk, and branch `Updated-frontend`. It is not a reproducible description of the current free deployment. Render documents that free services sleep after inactivity and that files are ephemeral: [free service behavior](https://render.com/docs/free), [persistent disks](https://render.com/docs/disks). Vercel's connection progress cannot make an ephemeral database durable.

**9. Security properties and limits**

Useful controls are present: HMAC-signed one-year session cookie with HttpOnly, Secure in production, SameSite=Lax and host-only behavior; server-derived actor IDs; timing-safe proxy secret checks; same-origin mutation checks in the Vercel bridge; body limits; per-IP/action rate limits; private live-card filtering; and server-side ranked action validation. Missing-credential and invalid-inference paths use safe practice fallbacks. No payment/deposit/prize system is implemented.

Limits: identities are browser-cookie accounts without recovery or revocation UX; display names need not be unique; limits and Cloud budgets are in-memory and assume one process; shared-IP users can share a rate bucket. Authenticated practice callers can supply synthetic board/odds data, so that endpoint must stay unranked. The Zod schema bounds fields but does not require unique cards or matching card IDs/street length. Room codes are bearer knowledge for watching ordinary private rooms, not user invitation ACLs. These are relevant design boundaries, not all demonstrated exploits.

**10. Findings, ordered by impact**

**F1 — High: completed ranked settlement can be replayed. Confirmed with a real isolated database.**

After one completed ten-hand local match, the winner had rating 1222, `rated=1`, and one history row. The existing player sent join to the finished room at its current revision. The API accepted it, producing rating 1242, `rated=2`, and two history rows without another hand. Existing-member join returns success before checking room phase; `commit()` records ratings whenever the table is ranked and finished, even if `ranked.ratings` already exists. Revision comparison blocks stale simultaneous writes but does not block a later replay with the new revision.

Source: [join shortcut](../../src/lib/poker/live-table.ts:139), [terminal commit](../../backend/src/lib/live-rooms.ts:83), [Session model](../../prisma/schema.prisma:37).

Recommended fix: reject/no-op finished-room mutations before commit, record settlement only on the transition from unsettled to settled, and enforce a unique `(matchId, playerId)` history result or separate settlement record in the same transaction. Test sequential and concurrent replay, including join after finish.

**F2 — High: startup failures can replace a returning player's identity. Confirmed offline with mocked network.**

`boot()` makes one profile request. A 502/timeout leaves the app at onboarding. After health recovers, Claim Seat posts a new profile rather than retrying session resume. The reproduced request sequence was GET profile → failed resume → GET health → POST profile, with no second identity GET. The new cookie replaces access to the old profile even if its database row still exists. The recent wake-up change helps first-time profile creation, but not this returning-player case.

Source: [boot/create](../../src/store/game.ts:309). Recommended fix: distinguish 401/no session from retryable infrastructure errors; wait and retry identity before offering account creation; retain an existing valid identity until the backend has actually rejected it. Do not silently create another profile to recover from an outage.

**F3 — High: free local database is not durable. Observed host configuration and documented platform behavior.**

All identity, sessions, rooms, queue assignments, and ratings currently reside in `/tmp/elo.db` on the free service. Restarts/redeploys can remove them. A stable signing secret preserves cookie signatures, not missing Player rows. Recommended fix: persistent external database with a deployment-appropriate Prisma provider/adapter, or a persistent Render disk. A free managed database option would require its own account/configuration and is not already implemented.

**F4 — Medium: a short all-in can incorrectly reopen raising on later streets. Confirmed through the engine.**

Three-player example: each player contributed 50 on an earlier street; on the turn A bets 100, B goes all-in to 150, C calls 150. When action returns to A, only a 50 increase occurred, less than the 100 full raise. The engine incorrectly returns `canRaise=true`, `isRaiseLocked=false`. It compares B's whole-hand `totalBet=200` against current-street `currentBet=150`. This is a unit mismatch in the shared engine, affecting practice and multiway private rooms.

Source: [raise lock](../../src/lib/poker/engine.ts:318). Rule reference: [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/) on reopening betting after short all-ins. Recommended fix: track current-street full raises and each actor's faced/action level explicitly; test both one short all-in and cumulative short all-ins. Substituting `bet` for `totalBet` alone may not cover every reopening case.

**F5 — Medium: public ranked ladder/activity mixes simulated bot results with real players. Verified code path.**

GET leaderboard seeds 34 rivals and approximately every 45 seconds can simulate one or two rival results using random utilities. It writes Player and Session data even without a real played match. Response rows omit `isRival`, so normal UI has no explicit provenance field. Recommended fix: separate practice-bot rankings and simulated activity from the real ranked ladder, or label and filter them explicitly. Make real leaderboard reads free of simulation writes.

Source: [seeding/drift](../../backend/src/app/api/leaderboard/route.ts:21), [GET and response](../../backend/src/app/api/leaderboard/route.ts:134).

**F6 — Medium: abandoned matches do not autonomously finish and can hold a queue assignment. Confirmed clock behavior; lockout is a code-traced consequence.**

A ten-minute time jump followed by one `advanceLiveTable()` call produced only a fold, zero completed hands, and a new deadline scheduled from the late read. No background worker catches up missed decisions. Queue code returns an existing unexpired room as matched before considering cancel. With nobody reading a room, the assignment can survive until room expiry rather than finish after normal turn limits.

Source: [advancement](../../src/lib/poker/live-table.ts:101), [request advancement](../../backend/src/lib/live-rooms.ts:98), [matched before cancel](../../backend/src/lib/ranked-queue.ts:27). Recommended fix: explicit disconnect/forfeit policy, durable due-work processing, or bounded deterministic catch-up from stored deadlines; release abandoned queue assignments consistently.

**F7 — Medium: profile cash rate combines lifetime and recent-window data. Confirmed formula.**

History returns at most 60 rows; Profile divides lifetime `profile.cashes` by that fetched count. Eighty lifetime first places divided by 60 rows displays 133%. Other statistics mix lifetime and last-60 values without a clear window label. Recommended fix: compute lifetime aggregates on the server, or calculate every displayed recent metric from the same fetched window. Include draws in any placement visualization deliberately rather than dropping place zero.

Source: [cash rate](../../src/components/views/Profile.tsx:76), [history cap](../../backend/src/app/api/history/route.ts:22).

**F8 — Medium: practice and private receipts do not imply persistent history. Verified code path/product gap.**

Practice falls through to a local receipt after disabled `the legacy house-rating endpoint`; private finalization only persists room state. Neither writes official history or Player totals under current settings. Recommended fix: decide whether unranked history is wanted; if so, store an explicit mode and unrated results through the appropriate trusted path. Do not turn on legacy practice ratings to obtain history.

Source: [practice settlement](../../src/store/game.ts:855), [private/terminal commit](../../backend/src/lib/live-rooms.ts:88).

**F9 — Medium: seed disclosure reveals more than the rendered showdown cards. Code-traced privacy consequence.**

The response hides folded hole cards, but reveals the seed once betting ends. `verifyDeck()` returns the entire shuffled order. Someone with the room's seat/button information can reconstruct folded hands after the hand. Recommended fix: make this transparency policy explicit, or use selective proofs if folded-card privacy after the hand is a requirement. Current filtering protects betting-time information; it does not provide permanent hole-card secrecy.

Source: [public seed](../../src/lib/poker/live-table.ts:220), [deck reconstruction](../../src/lib/poker/cards.ts:103).

**F10 — Medium: first-load leaderboard seeding is race-prone. Static concurrency inference, not stress-tested.**

Two requests can both observe fewer than 34 rivals and then both call `createMany()` with identical primary keys. Partial seeding also causes existing keys to be reinserted. The endpoint has no conflict recovery, and simulated rating update/history writes are separate operations. Recommended fix: migration/seed step or idempotent upserts and transactional simulation; add a concurrent fresh-database test.

**F11 — Low: top-60 lookup can omit the signed-in player and rank. Verified query logic.**

Leaderboard derives `me` only from its top-60 array. A lower-ranked player still has a valid profile but gets no `me` refresh/rank from that endpoint. Recommended fix: fetch the actor independently and calculate their global rank, while keeping the leaderboard paginated.

**F12 — Low: route and deployment drift complicate recovery. Verified sources/configuration.**

Root views cannot be deep-linked or restored, and errors during initial session resume do not have a distinct recovery state. The paid Blueprint and older branch differ from the live free/main deployment. Recommended fix: explicit route/state design and documented free versus persistent deployment profiles, without implying the free profile is durable.

**F13 — Medium: best-hand statistics retain the first winning hand, not the strongest. Verified code paths.**

Both live `scheduleDecision()` and the practice driver only set the best-hand string when it is empty. A player who first wins with a pair and later wins with a full house retains the pair as their best hand in the receipt/history path. Recommended fix: retain an evaluation score alongside the description and replace it when a stronger eligible hand occurs; clarify whether the statistic means best seen hand or best winning hand.

Source: [live tracking](../../src/lib/poker/live-table.ts:95), [practice tracking](../../src/store/game.ts:743).

**11. Recommended order of work and acceptance criteria**

First protect ranked integrity: F1 must make repeated terminal commands produce zero additional ratings/history rows. Add database-enforced identity for each match settlement, not only an application flag.

Then protect identity/data: fix F2 and choose durable storage for F3. An authenticated returning user must keep the same Player ID after a temporary backend failure and retry. A restart/redeploy test must preserve Player, Session, room and queue state when the intended production storage is configured.

Next fix game correctness and liveness: F4 needs independent rule-based tests for street raises and multiple short all-ins. F6 needs a documented disconnect policy and a test with both clients absent beyond several deadlines. Existing random hand fuzzing and valid-action tests do not cover every poker rule or every lifecycle transition.

Then make product data honest and internally consistent: separate simulated activity (F5), choose persistence policy for unranked modes (F8), and align profile aggregates/window labels (F7/F11). Resolve post-hand privacy policy (F9) and fresh-database concurrency (F10). Finally improve route durability and deployment parity (F12).

**12. Verification limits**

Passing HTTP smoke tests establish that cookies, proxying, an ordinary room, an action, SSE, ranked queue requests, and a bot call can work. Passing engine/evaluator/rating tests support the core algorithms. They do not establish replay resistance, correct short-raise rules, durable free-host storage, global traffic capacity, account recovery, or optimal bot strategy. This review found concrete counterexamples despite the previous green CI, so those missing acceptance cases matter more than repeating the existing smoke suite.

The appropriate current description is a functioning play-money prototype with real server-authoritative multiplayer, with specific ranked-integrity, lifecycle, reporting, and storage work remaining before a reliable public ranked launch.
