import { WorkspaceLibrary } from './workspaces.js';
import { PdfExporter } from './pdf-export.js';
import { LocalMineruPipeline, localMineruInstallation } from './mineru-local.js';
import { PdfStateStore } from './pdf-store.js';
import { readFile, writeFile, cp, stat, mkdir, rename, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class WorkspaceRuntime {
  private instances = new Map<string, { store: PdfStateStore; exporter: PdfExporter; mineru: LocalMineruPipeline }>();
  constructor(readonly library: WorkspaceLibrary, readonly legacyStore: PdfStateStore) {}
  async requireIdle(workspaceId: string, documentId?: string) { const w = await this.library.get(workspaceId); for (const d of w.documents.filter(d => !documentId || d.id === documentId)) { const scoped = await this.scope(workspaceId, d.id); const value = await scoped.mineru.status(d.id); if (!['idle', 'completed', 'failed'].includes(value.phase)) throw new Error('PDF 正在本机解析，请完成后再归档或移除'); } }
  async adoptLegacy(workspaceId: string, documentId: string) {
    const document = await this.library.document(workspaceId, documentId); const marker = join(document.projectDir, '.legacy-import.json');
    try { await stat(marker); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const target = this.library.stateStore(workspaceId); const prior = await target.read(documentId);
    if (prior.revision > 0) return;
    const legacy = await this.legacyStore.read(documentId); const oldFolder = this.legacyStore.mineruFolder(documentId); const newFolder = target.mineruFolder(documentId);
    const replace = (value: unknown): unknown => typeof value === 'string' ? value.replaceAll(oldFolder, newFolder) : Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)])) : value;
    try {
      const result = JSON.parse(await readFile(join(oldFolder, 'result.json'), 'utf8')); if (typeof result.directory !== 'string' || !result.directory.startsWith(oldFolder)) throw new Error('旧解析产物目录无效');
      const check = async (path: string) => { if ((await lstat(path)).isSymbolicLink()) throw new Error('旧解析产物不能使用符号链接'); for (const item of await readdir(path, { withFileTypes: true })) { const next = join(path, item.name); if (item.isSymbolicLink()) throw new Error('旧解析产物不能使用符号链接'); if (item.isDirectory()) await check(next); } }; await check(oldFolder);
      const temporary = `${newFolder}.${randomUUID()}.tmp`; await cp(oldFolder, temporary, { recursive: true, errorOnExist: true, force: false });
      const rewrite = async (path: string) => { for (const item of await readdir(path, { withFileTypes: true })) { const next = join(path, item.name); if (item.isDirectory()) await rewrite(next); else if (/\.json$/i.test(item.name)) { const value = JSON.parse(await readFile(next, 'utf8')); await writeFile(next, JSON.stringify(replace(value))); } } }; await rewrite(temporary); await rename(temporary, newFolder);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (legacy.revision) await target.update(documentId, replace({ annotations: legacy.annotations, viewState: legacy.viewState, sidebar: legacy.sidebar }) as Parameters<PdfStateStore['update']>[1]);
    await mkdir(document.projectDir, { recursive: true }); await writeFile(marker, JSON.stringify({ importedAt: new Date().toISOString() }), { flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
  }
  async scope(workspaceId?: string, documentId?: string) {
    if (workspaceId) { await this.library.get(workspaceId); if (documentId) await this.library.document(workspaceId, documentId); }
    const store = workspaceId ? this.library.stateStore(workspaceId) : this.legacyStore;
    let instance = this.instances.get(store.root);
    if (!instance) { instance = { store, exporter: new PdfExporter(store), mineru: new LocalMineruPipeline(store,{installation:()=>localMineruInstallation(this.library.baseDirectory())}) }; this.instances.set(store.root, instance); }
    return instance;
  }
  async close() { await Promise.all([...this.instances.values()].map(x => x.mineru.close())); }
}
