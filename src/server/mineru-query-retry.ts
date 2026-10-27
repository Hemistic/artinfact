// Only use this for status GETs. Retrying task creation after an ambiguous network error can duplicate charges.
export async function withMineruQueryRetry<T>(query: () => Promise<T>, onWait: (seconds: number) => void, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await query(); }
    catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const code = (error as { cause?: { code?: string } })?.cause?.code ?? '';
      const transient = /^(fetch failed|The operation was aborted|This operation was aborted|The operation was aborted due to timeout)$/i.test(text) || /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(code);
      if (!transient || attempt >= 4) throw error;
      const seconds = Math.min(16, 2 ** (attempt + 1)); onWait(seconds); await sleep(seconds * 1000);
    }
  }
}
