# Ranked ratings and profile statistics

Ranked Hold’em pairs two verified accounts and plays ten hands at fixed 10/20 blinds. Each hand starts with 1,500 chips. Total chip profit determines the winner. A win has the same rating effect at any winning margin. A draw scores 0.5, a win 1 and a loss 0. A single-player forfeit is a win and a loss. A void produces neither result nor rating change.

The match proposal stores both players’ rating, deviation, volatility and rated count. Settlement computes both results from those snapshots in one transaction. The first 12 ranked results use the placement pool. Older legacy results can contribute to historical rated counts and exposure, while the verified ranked placement count comes from ranked outcomes. Elo starts at 1200, RD 110 and volatility 0.06. It has no seasonal resets.

## Glicko-2 and the Elo adaptations

For rating \(r\) and deviation \(RD\), set \(\mu=(r-1500)/173.7178\) and \(\phi=RD/173.7178\). For each opponent use \(g(\phi_j)=(1+3\phi_j^2/\pi^2)^{-1/2}\) and \(E_j=(1+\exp(-g(\phi_j)(\mu-\mu_j)))^{-1}\). Let \(v^{-1}=\sum_j g_j^2 E_j(1-E_j)\) and \(d=\sum_j g_j(s_j-E_j)\). The volatility solver uses \(\Delta=vd\) and \(\tau=0.5\). The updated scaled deviation is \(\phi'=(1/(\phi^2+\sigma'^2)+1/v)^{-1/2}\) and \(\mu'=\mu+\phi'^2d\). See [Glickman’s worked example](https://www.glicko.net/glicko/glicko2.pdf).

The game treats one completed ranked match as one immediate result period. The paper recommends multiple results per period for the model’s statistical behavior. Elo uses immediate feedback as a prototype product choice and applies the existing exposure limiter \(c\tanh(\Delta r/c)\) to rating movement. The cap is 27 below 12 rated results, 60 at rating 1900 or at least 120 rated results, 52 at rating 1600 or at least 60 rated results, and 42 otherwise. Elo rounds rating and RD, limits rating to 400–4000 and RD to 55–350, and clamps volatility to 0.02–0.20. The reference test exercises the raw calculation before these Elo rules.

For inactivity, one empty period is one complete 24 hours since the most recent rated result, or account creation for a new player. Effective deviation is \(\min(350,\sqrt{RD^2+n(173.7178\sigma)^2})\), with the same 55-point floor. Reads calculate it from the stored baseline and timestamp, so repeated reads do not compound the result. Rating and volatility retain their values between games. Ranked matchmaking and the match snapshot use the effective deviation.

## Records and drift

Profile totals use all recorded rows belonging to the viewer. The first-place rate displays the number of firsts and the number of recorded sessions. The ledger displays the latest 60 rows. The chart uses the rated rows within that window and their real settlement timestamps. The hand details distinguish the highest hand seen from the highest winning hand when those fields are available.

The worker captures a UTC daily rating snapshot. It stores the visible ladder total and compares changes in the accounting total to the cumulative result ledger and new accounts at 1200. Accounting includes closed real accounts so closure alone does not flag drift. Unexplained movement produces a structured `rating_drift` event for operator review. The initial snapshot establishes a baseline.
