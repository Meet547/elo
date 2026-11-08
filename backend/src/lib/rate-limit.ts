import { createHmac } from "node:crypto";
import { db } from "./db";
import {inTransaction,type DatabaseClient} from "./unit-of-work";
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
export async function rateLimit(
  req: NextRequest,
  bucket: string,
  max: number,
  windowMs: number,
  actor?: string,
  client:DatabaseClient=db,
): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Date.now();
  if (req.method !== "GET" || bucket === "auth:google") {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 16) throw new Error("Stable session secret is required for durable mutation limits.");
    const scopes = [`ip:${clientKey(req)}`, ...(actor ? [`account:${actor}`] : [])];
    const results = await inTransaction(client,async tx => {
      const rows: { count: number; resetAt: Date }[] = [];
      for (const scope of scopes) {
        const key = createHmac("sha256", secret).update(`${bucket}:${scope}`).digest("hex");
        const resetAt = new Date(now + windowMs);
        const result = await tx.$queryRaw<{ count: number; resetAt: Date }[]>`
          INSERT INTO "RateWindow" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
          ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateWindow"."resetAt" <= ${new Date(now)} THEN 1 ELSE "RateWindow"."count" + 1 END,
          "resetAt" = CASE WHEN "RateWindow"."resetAt" <= ${new Date(now)} THEN ${resetAt} ELSE "RateWindow"."resetAt" END
          RETURNING "count", "resetAt"`;
        rows.push(result[0]);
      }
      return rows;
    });
    const blocked = results.filter(row => row.count > max);
    return { ok: blocked.length === 0, retryAfter: blocked.length ? Math.max(1, ...blocked.map(row => Math.ceil((row.resetAt.getTime() - now) / 1000))) : 0 };
  }
  // Read-only endpoints keep bounded local traffic counters and never mutate the database.

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
