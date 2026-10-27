import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const delays = [25, 50, 100, 200, 400, 800];

export async function renameWithRetry(source: string, target: string, operations: {
  rename: (source: string, target: string) => Promise<void>;
  sleep: (delay: number) => Promise<unknown>;
} = { rename, sleep: setTimeout }): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await operations.rename(source, target); return; }
    catch (error) {
      // Windows scanners and readers can briefly hold a replacement target open.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= delays.length) throw error;
      await operations.sleep(delays[attempt]);
    }
  }
}
