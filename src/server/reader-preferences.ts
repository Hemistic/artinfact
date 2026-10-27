import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const ReaderAppearanceSchema = z.object({ scheme: z.enum(['light', 'dark']), paper: z.enum(['light', 'dark']).optional() });
const settings = z.object({ version: z.literal(1), appearance: ReaderAppearanceSchema });
export class ReaderPreferencesStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private root: string) {}
  async read() {
    let text: string;
    try { text = await readFile(join(this.root, 'preferences.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try { return settings.parse(JSON.parse(text)).appearance; }
    catch { throw new Error('阅读器外观设置损坏，已保留原文件'); }
  }
  write(input: z.infer<typeof ReaderAppearanceSchema>) {
    const appearance = ReaderAppearanceSchema.parse(input);
    const operation = this.pending.catch(() => undefined).then(async () => {
      await mkdir(this.root, { recursive: true });
      const temporary = join(this.root, `preferences.${randomUUID()}.tmp`);
      try { await writeFile(temporary, JSON.stringify({ version: 1, appearance })); await rename(temporary, join(this.root, 'preferences.json')); }
      finally { await unlink(temporary).catch(() => undefined); }
    });
    this.pending = operation; return operation;
  }
}
