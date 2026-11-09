# Ranked matchmaking

Each candidate starts with a radius of half their current rating deviation rounded to a whole point, with a 75-point floor. The radius expands by 25 points every ten seconds up to 350. The gap must fit both players’ radii. Placement and established pools stay separate. Each search ends after three minutes.

The same pair has a ten-minute cooldown after a played match and a one-minute cooldown after a proposal. The queue excludes the searching player by ID. A shared trusted network address adds a 40-point ranking penalty. This affects preference, while a compatible pair can still match. After two minutes, compatible older tickets take priority. An expiring keyed hash is kept on the waiting ticket. The match stores only a shared-network flag and clears the hash from assigned tickets.

The browser opens an authenticated SSE stream. Postgres publishes committed assignment changes through the existing listener. A connection renews the ticket and reconsideration of its rating window every 22 seconds. Reconnect gets the latest state. The three-minute deadline also wakes the stream to report expiry. Session revocation closes the stream. The legacy POST poll remains for opening the page and compatibility.

The seeded test generated one arrival per second in two pools with separate rating and RD distributions and renewed searches at the stream lease interval. Of 10,000 entries, 9,976 matched and 24 expired. Waits among matched entries were 3 seconds median, 58 seconds p95 and 179 seconds maximum. Gaps were 51 points median, 134 p95 and 326 maximum. Every entry matched or expired by the cap. The sample measures the policy under the fixture’s arrivals and does not predict availability for isolated ratings.

Run `npm run test:ranked-policy` for the simulation and `npm run test:ranked-events` for the isolated Postgres stream, cooldown, expiry and revocation checks.
