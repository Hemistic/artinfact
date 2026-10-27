import { mkdir, readFile, writeFile, unlink, open, stat, readdir, realpath, rename } from 'node:fs/promises';
import { join, basename, relative, isAbsolute, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PdfStateStore } from './pdf-store.js';
import { MAX_PDF_BYTES } from './reader-service.js';
import { renameWithRetry } from './atomic-rename.js';

export const WorkspaceIdSchema = z.string().regex(/^(default|ws-[a-f0-9]{16})$/);
export const DocumentIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ReadingIdSchema = z.union([DocumentIdSchema, z.string().regex(/^md:[^\\/\u0000-\u001f]+\.md$/i).max(163)]);
const sessionSchema = z.object({ openTabs: z.array(ReadingIdSchema).max(64), activeDocumentId: z.string(), updatedAt: z.string() });
const entrySchema = z.object({ id: WorkspaceIdSchema, name: z.string().min(1).max(160), createdAt: z.string(), updatedAt: z.string(), lastSession: sessionSchema });
const indexSchema = z.object({ version: z.literal(1), activeWorkspaceId: WorkspaceIdSchema, workspaces: z.array(entrySchema).min(1).max(100) }).superRefine((value, context) => { if (new Set(value.workspaces.map(w => w.id)).size !== value.workspaces.length || !value.workspaces.some(w => w.id === value.activeWorkspaceId)) context.addIssue({ code: 'custom', message: '工作区索引中的标识不一致' }); });
const documentSchema = z.object({ id: DocumentIdSchema, name: z.string().min(1).max(240), title: z.string().max(500).optional(), author: z.string().max(500).optional(), size: z.number().int().positive().max(MAX_PDF_BYTES), importedAt: z.string(), lastOpenedAt: z.string(), originalPath: z.string().optional() });
export type WorkspaceDocument = z.infer<typeof documentSchema> & { sourcePath: string; projectDir: string };
export type WorkspaceEntry = z.infer<typeof entrySchema> & { rootDir: string; documents: WorkspaceDocument[]; notes: { name: string; modifiedAt: string }[] };
export type WorkspaceSnapshot = { root: string; activeWorkspaceId: string; workspaces: WorkspaceEntry[] };
const now = () => new Date().toISOString();
const emptySession = () => ({ openTabs: [] as string[], activeDocumentId: '', updatedAt: now() });
function title(value: string) { const text = value.replace(/\s+/g, ' ').trim().slice(0, 160); if (!text) throw new Error('请输入工作区名称'); return text; }
async function atomic(path: string, value: string) { const temporary = `${path}.${randomUUID()}.tmp`; await mkdir(dirname(path), { recursive: true }); try { await writeFile(temporary, value, { mode: 0o600 }); await renameWithRetry(temporary, path); } finally { await unlink(temporary).catch(() => undefined); } }

// Port of pdf-ai/main.js workspace lifecycle and shell session contracts. Electron IPC is replaced by MCP.
export class WorkspaceLibrary {
  private readonly workspaceReads=new Map<string,Promise<WorkspaceEntry>>();
  constructor(private rootProvider: () => string) {}
  private root() { const path = this.rootProvider(); if (!isAbsolute(path)) throw new Error('工作区根目录必须为绝对路径'); return path; }
  baseDirectory() { return this.root(); }
  private folder(id: string) { WorkspaceIdSchema.parse(id); return join(this.root(), 'workspaces', id); }
  stateStore(id: string) { return new PdfStateStore(this.folder(id), true); }
  private async boundary(path: string) { const root = await realpath(this.root()); await mkdir(path, { recursive: true }); const canonical = await realpath(path); const rel = relative(root, canonical); if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('资料目录超出工作区边界'); return canonical; }
  private async index() {
    try { return indexSchema.parse(JSON.parse(await readFile(join(this.root(), 'workspace-state.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('工作区索引损坏，原文件已保留'); }
    const createdAt = now(); return { version: 1 as const, activeWorkspaceId: 'default', workspaces: [{ id: 'default', name: '默认工作区', createdAt, updatedAt: createdAt, lastSession: emptySession() }] };
  }
  private async mutate<T>(fn: (state: z.infer<typeof indexSchema>) => Promise<T> | T): Promise<T> {
    const root = this.root(); await mkdir(root, { recursive: true }); const lockPath = join(root, '.workspace-state.lock'); let lock; const deadline = Date.now() + 10000;
    while (!lock) { try { lock = await open(lockPath, 'wx'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const age = await stat(lockPath).then(s => Date.now() - s.mtimeMs, () => 0); if (age > 120000) { await unlink(lockPath).catch(() => undefined); continue; } if (Date.now() > deadline) throw new Error('工作区正在保存，请稍后重试'); await new Promise(r => setTimeout(r, 30)); } }
    this.workspaceReads.clear();try { const state = await this.index(); const result = await fn(state); await atomic(join(root, 'workspace-state.json'), JSON.stringify(indexSchema.parse(state), null, 2)); return result; }
    finally { this.workspaceReads.clear();await lock.close(); await unlink(lockPath).catch(() => undefined); }
  }
  private async ensure() { await this.mutate(async state => { for (const w of state.workspaces) { await this.boundary(this.folder(w.id)); await this.boundary(join(this.folder(w.id), 'notes')); } }); }
  async list(): Promise<WorkspaceSnapshot> { await this.ensure(); const state = await this.index(); return { root: this.root(), activeWorkspaceId: state.activeWorkspaceId, workspaces: await Promise.all(state.workspaces.map(w => this.get(w.id))) }; }
  async get(id:string):Promise<WorkspaceEntry>{const key=this.root()+'\0'+id,existing=this.workspaceReads.get(key);if(existing)return structuredClone(await existing);const task=this.readWorkspace(id);this.workspaceReads.set(key,task);try{return structuredClone(await task);}finally{if(this.workspaceReads.get(key)===task)this.workspaceReads.delete(key);}}
  private async readWorkspace(id: string): Promise<WorkspaceEntry> {
    if (!WorkspaceIdSchema.safeParse(id).success) throw new Error('无效的工作区标识'); const state = await this.index(); const value = state.workspaces.find(w => w.id === id); if (!value) throw new Error('工作区不存在'); const rootDir = await this.boundary(this.folder(id)); const documents: WorkspaceDocument[] = [];
    for (const item of await readdir(rootDir, { withFileTypes: true })) {
      if (!item.isDirectory() || !DocumentIdSchema.safeParse(item.name).success) continue;
      const projectDir = await this.boundary(join(rootDir, item.name));
      try { const doc = documentSchema.parse(JSON.parse(await readFile(join(projectDir, 'document.json'), 'utf8'))); if (doc.id !== item.name) throw new Error('文档标识不一致'); documents.push({ ...doc, projectDir, sourcePath: join(projectDir, 'source.pdf') }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('文档索引损坏，原文件已保留'); }
    }
    documents.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    const notesDir = await this.boundary(join(rootDir, 'notes')); const notes = [];
    for (const item of await readdir(notesDir, { withFileTypes: true })) if (item.isFile() && /\.md$/i.test(item.name)) notes.push({ name: item.name, modifiedAt: (await stat(join(notesDir, item.name))).mtime.toISOString() });
    return { ...value, rootDir, documents, notes };
  }
  async create(name: string) { const id = `ws-${randomUUID().replaceAll('-', '').slice(0, 16)}`; await this.mutate(async state => { if (state.workspaces.length >= 100) throw new Error('最多 100 个工作区'); const createdAt = now(); await this.boundary(this.folder(id)); state.workspaces.push({ id, name: title(name), createdAt, updatedAt: createdAt, lastSession: emptySession() }); state.activeWorkspaceId = id; }); return this.get(id); }
  async rename(id: string, name: string) { await this.mutate(state => { const w = state.workspaces.find(w => w.id === id); if (!w) throw new Error('工作区不存在'); w.name = title(name); w.updatedAt = now(); }); }
  async activate(id: string) { await this.get(id); await this.mutate(state => { state.activeWorkspaceId = id; }); }
  async archive(id: string) { await this.get(id); await this.mutate(async state => { if (state.workspaces.length <= 1) throw new Error('至少保留一个工作区'); const target = await this.boundary(this.folder(id)); const archives = await this.boundary(join(this.root(), 'workspace-archives')); await rename(target, join(archives, `${id}-${Date.now()}`)); state.workspaces = state.workspaces.filter(w => w.id !== id); if (state.activeWorkspaceId === id) state.activeWorkspaceId = state.workspaces[0].id; }); }
  async importBytes(workspaceId: string, name: string, bytes: Buffer, originalPath?: string): Promise<WorkspaceDocument> {
    await this.get(workspaceId); if (basename(name) !== name || /[\\/\u0000-\u001f]/.test(name) || !/\.pdf$/i.test(name) || name.length > 240 || !bytes.length || bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('请选择不超过 64 MB 的有效 PDF');
    const id = createHash('sha256').update(bytes).digest('hex'); const projectDir = await this.boundary(join(this.folder(workspaceId), id)); const sourcePath = join(projectDir, 'source.pdf');
    await this.mutate(async () => {
      let existing: z.infer<typeof documentSchema> | undefined;
      try { existing = documentSchema.parse(JSON.parse(await readFile(join(projectDir, 'document.json'), 'utf8'))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('文档索引损坏，原文件已保留'); }
      if (!existing) { if ((await this.get(workspaceId)).documents.length >= 500) throw new Error('每区最多 500 份 PDF'); await writeFile(sourcePath, bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); }
      const doc = { ...existing, id, name: existing?.name ?? name, size: bytes.length, importedAt: existing?.importedAt ?? now(), lastOpenedAt: now(), ...(originalPath ? { originalPath } : {}) }; await atomic(join(projectDir, 'document.json'), JSON.stringify(doc, null, 2));
    });
    return (await this.get(workspaceId)).documents.find(d => d.id === id)!;
  }
  async document(workspaceId: string, id: string) { DocumentIdSchema.parse(id); const doc = (await this.get(workspaceId)).documents.find(d => d.id === id); if (!doc) throw new Error('PDF 不属于此工作区'); await this.boundary(doc.projectDir); return doc; }
  async touch(workspaceId: string, id: string) { const doc = await this.document(workspaceId, id); await this.mutate(async () => { const { sourcePath: _source, projectDir: _project, ...value } = doc; await atomic(join(doc.projectDir, 'document.json'), JSON.stringify({ ...value, lastOpenedAt: now() }, null, 2)); }); }
  async metadata(workspaceId: string, id: string, title: string, author: string) { await this.mutate(async () => { const doc = await this.document(workspaceId, id); const { sourcePath: _source, projectDir: _project, ...value } = doc; await atomic(join(doc.projectDir, 'document.json'), JSON.stringify({ ...value, title: title.replace(/\s+/g, ' ').trim().slice(0, 500) || doc.name, author: author.replace(/\s+/g, ' ').trim().slice(0, 500) }, null, 2)); }); }
  async saveNoteAsset(id: string, data: string) { await this.get(id); const match = data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/); if (!match || match[2].length > 12 * 1024 * 1024) throw new Error('批注图片无效或超过 8 MB'); const bytes = Buffer.from(match[2], 'base64'); if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('批注图片无效或超过 8 MB'); const folder = await this.boundary(join(this.folder(id), 'notes', 'assets')); const name = `${createHash('sha256').update(bytes).digest('hex')}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`; await writeFile(join(folder, name), bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); return { path: `assets/${name}` }; }
  async removeDocument(workspaceId: string, id: string) { const doc = await this.document(workspaceId, id); await this.mutate(async state => { const archive = await this.boundary(join(this.folder(workspaceId), '.archives')); await rename(doc.projectDir, join(archive, `${id}-${Date.now()}`)); const w = state.workspaces.find(w => w.id === workspaceId)!; w.lastSession.openTabs = w.lastSession.openTabs.filter(x => x !== id); if (w.lastSession.activeDocumentId === id) w.lastSession.activeDocumentId = w.lastSession.openTabs[0] ?? ''; }); }
  async session(id: string, tabs: string[], active: string) { const w = await this.get(id); if (tabs.length > 64 || tabs.some(d => !w.documents.some(x => x.id === d) && !w.notes.some(x => `md:${x.name}` === d)) || (active && !tabs.includes(active))) throw new Error('阅读标签不属于此工作区'); await this.mutate(state => { state.workspaces.find(w => w.id === id)!.lastSession = { openTabs: [...new Set(tabs)], activeDocumentId: active, updatedAt: now() }; }); }
  private notePath(id: string, name: string) { if (basename(name) !== name || /[<>:"\\/\u0000-\u001f]/.test(name) || !/\.md$/i.test(name) || name.length > 160 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('无效的笔记文件名'); return join(this.folder(id), 'notes', name); }
  async createNote(id: string, value: string) { await this.get(id); const stem = title(value).replace(/[<>:"\\/\u0000-\u001f]/g, ' ').replace(/[. ]+$/g, '').slice(0, 140); if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) throw new Error('无效的笔记名称'); const name = `${stem}.md`; await writeFile(this.notePath(id, name), `# ${value}\n`, { flag: 'wx', mode: 0o600 }); return { name }; }
  async readNote(id: string, name: string) { await this.get(id); const path = this.notePath(id, name); const canonical = await realpath(path); const rel = relative(await realpath(join(this.folder(id), 'notes')), canonical); if (rel.startsWith('..') || isAbsolute(rel) || (await stat(path)).size > 8 * 1024 * 1024) throw new Error('笔记超出工作区范围或大小限制'); const text = await readFile(path, 'utf8'); return { name, text, revision: createHash('sha256').update(text).digest('hex') }; }
  async writeNote(id: string, name: string, text: string, revision?: string) { if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('笔记超过 2 MB'); await this.mutate(async () => { const current = await this.readNote(id, name); if (revision && current.revision !== revision) throw new Error('Markdown 已被其他窗口或程序修改，未覆盖原文件；请保留当前草稿并重新打开'); await atomic(this.notePath(id, name), text); }); return { name, text, revision: createHash('sha256').update(text).digest('hex') }; }
  async importNote(id: string, value: string, text: string) { await this.get(id); this.notePath(id, value); let name = value; const stem = value.slice(0, -3); await this.mutate(async () => { for (let n = 2; ; n++) { try { await writeFile(this.notePath(id, name), text, { flag: 'wx', mode: 0o600 }); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; name = stem.slice(0, 135) + ' (' + n + ').md'; } } }); return this.readNote(id, name); }
  async renameNote(id: string, name: string, next: string) { this.notePath(id, next); await this.mutate(async state => { const value = await this.readNote(id, name); if (name === next) return; await writeFile(this.notePath(id, next), value.text, { flag: 'wx', mode: 0o600 }); await unlink(this.notePath(id, name)); const session = state.workspaces.find(w => w.id === id)!.lastSession; session.openTabs = session.openTabs.map(x => x === 'md:' + name ? 'md:' + next : x); if (session.activeDocumentId === 'md:' + name) session.activeDocumentId = 'md:' + next; }); return this.readNote(id, next); }
  async noteAssets(id: string, name: string) {
    const note = await this.readNote(id, name);
    const result: { path: string; mimeType: string; data: string }[] = [];
    const folder = await realpath(join(this.folder(id), 'notes')); let total = 0;
    for (const path of new Set(note.text.match(/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)/g) ?? [])) {
      try {
        const canonical = await realpath(join(folder, path)); const rel = relative(folder, canonical);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('图片超出工作区范围');
        const size = (await stat(canonical)).size; total += size;
        if (size > 8 * 1024 * 1024 || total > 16 * 1024 * 1024) throw new Error('Markdown 图片总量超过 16 MB');
        result.push({ path, mimeType: path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: (await readFile(canonical)).toString('base64') });
      } catch (error) {
        // Keep the Markdown readable when an image was moved or deleted; the editor shows the missing image.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return result;
  }

}
