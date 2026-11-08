import { forwardApi } from '@/lib/server/api-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return forwardApi(request, (await context.params).path);
}
export { handle as GET, handle as POST, handle as DELETE, handle as PATCH, handle as PUT, handle as OPTIONS };
