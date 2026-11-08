/** Only an explicit 401 means anonymous. A sleeping host cannot revoke identity. */
export async function resumeProfile<T>(options: {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pauseMs?: number;
} = {}): Promise<T | null> {
  const request = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 120_000);
  do {
    let response: Response | undefined;
    try {
      response = await request('/api/profile', {
        credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - now()))),
      });
    } catch { /* network failures leave the existing cookie intact */ }
    if (response?.status === 401) return null;
    if (response?.ok) {
      const data = await response.json().catch(() => null);
      if (data?.player && typeof data.player.id === 'string') return data.player as T;
    } else if (response && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new Error('Unable to restore your seat. Please retry the connection.');
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(options.pauseMs ?? 2_000, remaining));
  } while (now() < deadline);
  throw new Error('The room is still waking up. Your existing seat is preserved. Retry the connection in a moment.');
}
