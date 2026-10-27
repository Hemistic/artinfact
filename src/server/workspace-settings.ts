import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareWorkspace, documentsFolder } from './default-workspace.js';
import { resolveWorkspace } from '../shared/layout.js';
import { renameWithRetry } from './atomic-rename.js';

export class WorkspaceSettings {
  private current = '';
  private source = 'documents';
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private override?: string, private documents = documentsFolder) {}
  read() { return { workspace: this.current, source: this.source, environmentOverride: !!this.override?.trim() }; }
  async initialize() {
    let saved: string | undefined;
    if (!this.override?.trim()) {
      try {
        const value = JSON.parse(await readFile(join(this.root, 'workspace-settings.json'), 'utf8'));
        if (value.version !== 1 || typeof value.workspace !== 'string' || !value.workspace) throw new Error('invalid');
        saved = value.workspace;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('工作目录设置损坏，原文件已保留'); }
    }
    this.current = await prepareWorkspace(this.override?.trim() || saved, this.documents);
    this.source = this.override?.trim() ? 'environment' : saved ? 'saved' : 'documents';
    return this.read();
  }
  async set(path: string) {
    const workspace = await resolveWorkspace(path);
    const operation = this.writes.catch(() => undefined).then(async () => {
      await mkdir(this.root, { recursive: true });
      const target = join(this.root, 'workspace-settings.json'); const temp = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temp, JSON.stringify({ version: 1, workspace }), { mode: 0o600 }); await renameWithRetry(temp, target); }
      finally { await unlink(temp).catch(() => undefined); }
      this.current = workspace; this.source = 'saved'; return this.read();
    });
    this.writes = operation; return operation;
  }
}
