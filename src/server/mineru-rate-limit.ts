export async function withMineruRateLimit<T>(action: () => Promise<T>, onWait: (seconds: number) => void, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      const match = /^Too many requests(?: for this API key)?\. Retry in (\d+) (seconds?|minutes?)\.$/i.exec(error instanceof Error ? error.message : String(error));
      if (!match || attempt >= 3) throw error;
      const seconds = Number(match[1]) * (/minute/i.test(match[2]) ? 60 : 1) + 1;
      if (seconds > 121) throw error;
      onWait(seconds); await sleep(seconds * 1000);
    }
  }
}
