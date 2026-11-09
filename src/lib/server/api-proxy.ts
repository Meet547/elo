/** Same-origin bridge: browsers never need Render cookies or the proxy secret. */
export async function forwardApi(request: Request, path: string[]) {
  const origin = process.env.BACKEND_ORIGIN;
  const secret = process.env.BACKEND_PROXY_SECRET;
  if (!origin || !secret) return Response.json({ error: "Backend is not configured." }, { status: 503 });
  if (path.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) return Response.json({ error: "Invalid path." }, { status: 400 });
  const incoming = new URL(request.url);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const caller = request.headers.get('origin');
    const host = request.headers.get('host') || incoming.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || incoming.protocol.slice(0, -1);
    const publicOrigin = `${protocol}://${host}`;
    if (caller && caller !== publicOrigin) return Response.json({ error: "Origin not allowed." }, { status: 403 });
  }
  const target = new URL(`/api/${path.join('/')}`, origin);
  target.search = incoming.search;
  const headers = new Headers();
  for (const key of ['content-type', 'cookie', 'accept', 'last-event-id', 'idempotency-key']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set('x-elo-proxy-secret', secret);
  // Only Vercel's platform-provided client address is trusted in production.
  headers.set('x-elo-client-ip', request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'proxy');
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(path.length === 1 && path[0] === 'health' ? 8_000 : 28_000)]);
  try {
    if (Number(request.headers.get('content-length') || 0) > 65536) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 65536) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const response = await fetch(target, { method: request.method, headers, body, signal, cache: 'no-store', redirect: 'manual' });
    const outgoing = new Headers();
    for (const key of ['content-type', 'retry-after', 'x-accel-buffering', 'location']) {
      const value = response.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    outgoing.set('cache-control', 'private, no-store, no-transform');
    outgoing.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: 'The poker room is temporarily unavailable. Try again.' }, { status: 502 });
  }
}
