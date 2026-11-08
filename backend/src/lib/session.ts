// ---------------------------------------------------------------------------
// Session identity: new sessions use random opaque tokens stored only as hashes.
// Legacy HMAC cookies are accepted for migration until their owner revokes them.
// Player IDs and provider email addresses are never bearer credentials.
// ---------------------------------------------------------------------------

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";
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

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Opaque sessions can be revoked; legacy cookies retain identity until explicitly revoked. */
export async function sessionPlayer(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  if (raw.startsWith("v1.")) {
    if (!/^v1\.[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const record = await db.authSession.findUnique({ where: { tokenHash: tokenHash(raw) }, include: { player: true } });
    return record && record.expiresAt.getTime() > Date.now() && !record.player.deletedAt && !record.player.isSimulated ? record.playerId : null;
  }
  const playerId = verifySession(raw);
  if (!playerId) return null;
  const player = await db.player.findUnique({ where: { id: playerId } });
  return player && !player.legacySessionsRevoked && !player.deletedAt && !player.isSimulated ? playerId : null;
}

export async function setSessionCookie(res: NextResponse, playerId: string): Promise<void> {
  const value = `v1.${randomBytes(32).toString("base64url")}`;
  await db.authSession.create({ data: { tokenHash: tokenHash(value), playerId, expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000) } });
  res.cookies.set({ name: SESSION_COOKIE, value, httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
}

export async function revokePlayerSessions(playerId: string): Promise<void> {
  await db.$transaction([
    db.player.update({ where: { id: playerId }, data: { legacySessionsRevoked: true } }),
    db.authSession.deleteMany({ where: { playerId } }),
  ]);
}

export async function revokeRequestSession(req: NextRequest): Promise<void> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return;
  if (raw.startsWith("v1.")) await db.authSession.deleteMany({ where: { tokenHash: tokenHash(raw) } });
  else {
    const playerId = await sessionPlayer(req);
    // Legacy cookies have no individual session ID; revoke all legacy cookies for the owner.
    if (playerId) await db.player.update({ where: { id: playerId }, data: { legacySessionsRevoked: true } });
  }
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
