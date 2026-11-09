import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { readRankedQueue, updateRankedQueue, RankedEligibilityError } from "@/lib/ranked-queue";
import { realtime } from "../../../../lib/realtime";
import { SESSION_COOKIE, sessionPlayer } from "@/lib/session";
import { RANKED_SEARCH_MS, type RankedQueueStatus } from "@/lib/poker/ranked-match";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const actorId = await sessionPlayer(request);
  if (!actorId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const limit = await rateLimit(request, `queue:events:${actorId}`, 16, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const identity = { actorId, tag: createHash("sha256").update(token).digest("hex"), legacy: !token.startsWith("v1.") };
  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let watching = false;
      let changed = false;
      let pending = false;
      let last = "";
      let searchDeadline: ReturnType<typeof setTimeout> | undefined;
      const emit = (status: RankedQueueStatus | null) => {
        if (closed) return;
        if (!status) return close();
        const payload = JSON.stringify(status);
        if (payload !== last) {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          last = payload;
        }
        if (status.status !== "searching") return close();
        clearTimeout(searchDeadline);
        searchDeadline = setTimeout(() => void refresh(), Math.max(1, status.joinedAt + RANKED_SEARCH_MS - Date.now()));
      };
      const refresh = async () => {
        changed = true;
        if (pending || !watching || closed) return;
        pending = true;
        try {
          while (changed && !closed) {
            changed = false;
            emit(await readRankedQueue(actorId));
          }
        } catch {
          close();
        } finally {
          pending = false;
        }
      };
      const subscription = realtime.watchQueue({ identity, changed: () => void refresh(), close: () => close() });
      const lifetime = setTimeout(() => close(), 22_000);
      const heartbeat = setInterval(() => {
        if (!closed && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 10_000);
      close = () => {
        if (closed) return;
        closed = true;
        subscription.unsubscribe();
        clearTimeout(lifetime);
        clearTimeout(searchDeadline);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* already cancelled */ }
      };
      request.signal.addEventListener("abort", close, { once: true });
      void (async () => {
        await subscription.ready;
        if (closed || request.signal.aborted || await sessionPlayer(request) !== actorId || realtime.revoked(identity)) return close();
        // Renew this existing search once per stream lease. Reconnects also reconsider widening windows.
        const status = await updateRankedQueue(actorId, "poll");
        watching = true;
        if (changed && status?.status === "searching") await refresh();
        else emit(status);
      })().catch(error => {
        if (error instanceof RankedEligibilityError && !closed) {
          controller.enqueue(encoder.encode(`event: unavailable\ndata: ${JSON.stringify(error.message)}\n\n`));
        }
        close();
      });
    },
    cancel() { close(); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "private, no-store, no-transform", "x-accel-buffering": "no" },
  });
}
