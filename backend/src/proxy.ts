import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();
  if (!request.nextUrl.pathname.startsWith('/api/')) return new NextResponse(null, { status: 404 });
  const expected = process.env.BACKEND_PROXY_SECRET;
  const supplied = request.headers.get('x-elo-proxy-secret');
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next).*)'] };
