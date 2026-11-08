// ---------------------------------------------------------------------------
// Session identity.
//
// The player id is a cuid, not a credential. It is meaningful only when the
// server has signed it, so it travels in an httpOnly cookie:
//
//     <playerId>.<expEpochSeconds>.<hmac-sha256 base64url>
//
// The cookie is unforgeable without SESSION_SECRET, it cannot be read by
// client script, and every mutation route derives the actor from it instead of
// trusting a body field. Setting SESSION_SECRET keeps sessions valid across
// deploys; production refuses to sign sessions without it rather than
// inventing an unstable or predictable signing key.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "showdown_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function secret(): Buffer {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 16) return Buffer.from(env, "utf8");

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  // development only: stable across HMR and restarts, never used in production
  return Buffer.from("showdown-local-development-session-key", "utf8");
}

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

/** Issue a signed session value for a player. */
export function signSession(playerId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE;
  const payload = `${playerId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify a signed session value; returns the player id or null. */
export function verifySession(raw: string | undefined | null, now = Date.now()): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [playerId, expRaw, sig] = parts;
  if (!playerId || !/^\d+$/.test(expRaw)) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;

  const expected = sign(`${playerId}.${expRaw}`);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return playerId;
}

/** The authenticated player id for a request, or null. */
export function sessionPlayer(req: NextRequest): string | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(res: NextResponse, playerId: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: signSession(playerId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
