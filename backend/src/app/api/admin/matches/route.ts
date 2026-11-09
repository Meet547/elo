import { NextRequest } from "next/server";
import { z } from "zod";
import { sessionPlayer } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { accountIdentity } from "../../../../lib/google-auth";
import { commandHttp, commandLimited, runGameCommand } from "../../../../lib/command-receipts";
import { moderateMatch, reviewMatches } from "../../../../lib/match-moderation";

export const dynamic = "force-dynamic";
const input = z.object({
  matchId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  reason: z.string().trim().min(8).max(500),
});

export async function GET(request: NextRequest) {
  const actorId = await sessionPlayer(request);
  if (!actorId || !(await accountIdentity(actorId)).administrator) return commandHttp({ status: 403, body: { error: "Administrator access required." } });
  const limit = await rateLimit(request, `admin:review:${actorId}`, 30, 60_000);
  if (!limit.ok) return commandHttp(commandLimited(limit.retryAfter));
  return commandHttp({ status: 200, body: { matches: await reviewMatches() } });
}

export async function POST(request: NextRequest) {
  const actorId = await sessionPlayer(request);
  if (!actorId || !(await accountIdentity(actorId)).administrator) return commandHttp({ status: 403, body: { error: "Administrator access required." } });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return commandHttp({ status: 400, body: { error: "Supply a match ID and a reason between 8 and 500 characters." } });
  try {
    const result = await runGameCommand(actorId, "admin:match", request.headers.get("idempotency-key"), parsed.data, async tx => {
      const limit = await rateLimit(request, "admin:match", 10, 60_000, actorId, tx);
      if (!limit.ok) return commandLimited(limit.retryAfter);
      return moderateMatch(tx, actorId, parsed.data.matchId, parsed.data.reason);
    });
    return commandHttp(result);
  } catch {
    return commandHttp({ status: 503, body: { error: "Could not update this match. Retry with the same command key." } });
  }
}
