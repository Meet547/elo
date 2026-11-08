// ---------------------------------------------------------------------------
// Rate limiting — fixed window, per client per bucket.
//
// The app is a single Node process behind a proxy, so an in-memory counter is
// the right size: no shared store to run, no dependency. It protects the two
// endpoints that cost real writes (profile creation, settlement) from a loop
// and from accidental double-submits, and it fails open by design — a limiter
// outage must never take the table down.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
const MAX_KEYS = 10_000;

export function clientKey(req: NextRequest): string {
  const trusted = req.headers.get("x-elo-client-ip");
  if (trusted) return trusted;
  const forwarded = process.env.NODE_ENV === "production" ? null : req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/**
 * Count one hit against `bucket` for this client.
 * Returns `{ ok, retryAfter }` where retryAfter is in seconds.
 */
export function rateLimit(
  req: NextRequest,
  bucket: string,
  max: number,
  windowMs: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  // opportunistic sweep keeps the map from growing without a timer
  if (buckets.size > MAX_KEYS) {
    for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  }

  const key = `${bucket}:${clientKey(req)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

export function tooMany(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "too many requests" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": String(retryAfter),
    },
  });
}
