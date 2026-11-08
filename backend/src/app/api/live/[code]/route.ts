import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbEnabled } from "@/lib/db";
import { commandLiveRoom, readLiveRoom, roomCode } from "@/lib/live-rooms";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("check") }), z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("fold") }), z.object({ type: z.literal("raise"), to: z.int().positive() }),
]);
const payload = z.object({
  revision: z.int().nonnegative(),
  command: z.discriminatedUnion("type", [
    z.object({ type: z.literal("join") }), z.object({ type: z.literal("leave") }),
    z.object({ type: z.literal("start") }), z.object({ type: z.literal("act"), action }),
  ]),
});
type Context = { params: Promise<{ code: string }> };

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: Context) {
  const player = await sessionPlayer(req);
  if (!player) return json({ error: "Claim an Elo profile first." }, 401);
  const code = roomCode((await params).code);
  if (!code) return json({ error: "Enter a valid room code." }, 404);
  if (!dbEnabled) return json({ error: "Live rooms need a database connection." }, 503);
  const room = await readLiveRoom(code, player);
  return room ? json({ room }) : json({ error: "This room expired or does not exist." }, 404);
}

export async function POST(req: NextRequest, { params }: Context) {
  const player = await sessionPlayer(req);
  if (!player) return json({ error: "Claim an Elo profile first." }, 401);
  const code = roomCode((await params).code);
  if (!code) return json({ error: "Enter a valid room code." }, 404);
  if (!dbEnabled) return json({ error: "Live rooms need a database connection." }, 503);
  const limit = rateLimit(req, `live:act:${player}`, 90, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const body = payload.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "Invalid table command." }, 400);
  const { status, ...result } = await commandLiveRoom(code, player, body.data.revision, body.data.command);
  return json(result, status);
}
