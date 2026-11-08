import { NextRequest, NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { readLiveRoom, roomCode } from "@/lib/live-rooms";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { sessionPlayer } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const player = sessionPlayer(req);
  if (!player) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const code = roomCode((await params).code);
  if (!code) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  if (!dbEnabled) return NextResponse.json({ error: "Live rooms need a database connection." }, { status: 503 });
  const limit = rateLimit(req, `live:events:${player}`, 24, 60_000);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const first = await readLiveRoom(code, player);
  if (!first) return NextResponse.json({ error: "Room not found." }, { status: 404 });

  const encoder = new TextEncoder();
  const expires = Date.now() + 23_000;
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let revision = first.revision;
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      const close = () => {
        if (closed) return;
        stop();
        controller.close();
      };
      stop = () => {
        closed = true;
        clearTimeout(timer);
        req.signal.removeEventListener("abort", close);
      };
      const send = (message: string) => { if (!closed) controller.enqueue(encoder.encode(message)); };
      const next = async () => {
        if (closed || Date.now() >= expires) return close();
        try {
          const room = await readLiveRoom(code, player);
          if (!room) {
            send("event: expired\ndata: {}\n\n");
            return close();
          }
          if (room.revision !== revision) {
            revision = room.revision;
            send(`data: ${JSON.stringify(room)}\n\n`);
          }
          if (closed || room.status === "finished" || room.status === "closed") return close();
          timer = setTimeout(next, 450);
        } catch {
          close(); // EventSource reconnects and fetches the current revision.
        }
      };
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) return close();
      send(`retry: 750\ndata: ${JSON.stringify(first)}\n\n`);
      timer = setTimeout(next, 450);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
