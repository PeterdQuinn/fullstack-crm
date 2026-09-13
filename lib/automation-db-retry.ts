// Only use for reads and idempotent run-record writes, never the stage itself.
export async function retryAutomationDb<T extends { error: { message: string; code?: string } | null; status?: number }>(
  operation: () => PromiseLike<T>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await operation();
    const transient = result.error && (
      [0, 429, 502, 503, 504].includes(result.status ?? -1) ||
      /gateway timeout|fetch failed|connection reset|connection refused|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(result.error.message)
    );
    if (!transient || attempt === 2) return result;
    console.warn(`Automation database temporarily unavailable; retry ${attempt + 1}/2`);
    await sleep(500 * 2 ** attempt);
  }
}
