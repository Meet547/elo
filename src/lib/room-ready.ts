/** Poll only a safe GET while a free host wakes; never replay profile creation. */
export async function waitForRoomReady(options: { timeoutMs?: number; requestTimeoutMs?: number; pauseMs?: number } = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(options.requestTimeoutMs ?? 12_000, deadline - Date.now()))),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok === true) return;
      if (response.status === 503 && data?.error === 'Backend is not configured.') {
        throw new Error('The room connection has not been configured. Please contact the site owner.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('has not been configured')) throw error;
      // Network errors, host-generated HTML and temporary 5xx responses can recover.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(options.pauseMs ?? 2_000, remaining)));
  }
  throw new Error('The room is taking longer to wake up. Please try again in a minute.');
}
