import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { WorkspaceLibrary } from './workspaces.js';
import { renameWithRetry } from './atomic-rename.js';
import { pageReference, type PagesPreview, type PagesRequest } from '../shared/pages-preview.js';

export const PagePayloadSchema = z.object({ pageId: z.string().regex(/^page_[a-f0-9]{32}$/), url: z.string().max(500), title: z.string().min(1).max(1000), blocks: z.array(z.object({ id: z.string().min(1).max(200), kind: z.enum(['markdown', 'agent_instructions']), hash: z.string().min(1).max(200), markdown: z.string().max(2 * 1024 * 1024) })).max(2000), sequence: z.number().int().nonnegative().optional() });
type Payload = z.infer<typeof PagePayloadSchema>;
const requestSchema = z.object({ id: z.string().uuid(), intent: z.enum(['create', 'refresh']), sourceRevision: z.string(), createdAt: z.string(), pageId: z.string().optional(), url: z.string().optional(), status: z.enum(['pending', 'completed', 'failed']), delivery: z.enum(['sent', 'draft', 'manual']).optional(), error: z.string().optional(), resultHash: z.string().optional() });
const stateSchema = z.object({ version: z.literal(1), name: z.string(), cache: PagePayloadSchema.extend({ syncedAt: z.string(), sourceRevision: z.string() }).optional(), request: requestSchema.optional() });
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const within = (root: string, path: string) => { const rel = relative(root, path); if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error('Pages 缓存超出工作区边界'); };

// Cloud snapshots have their own store. A sync never writes to notes/*.md.
export type PagesNoteSource={get:WorkspaceLibrary['get'];readNote(id:string,name:string):Promise<{name:string;text:string;revision:string;title?:string}>};
export class PagesPreviewStore {
  constructor(private library: PagesNoteSource) {}
  private async scope(workspaceId: string, name: string) {
    const note = await this.library.readNote(workspaceId, name);
    const workspace = await this.library.get(workspaceId); const root = await realpath(workspace.rootDir);
    const folder = join(root, '.pages'); await mkdir(folder, { recursive: true }); within(root, await realpath(folder));
    const path = join(folder, digest(name) + '.json');
    try { within(folder, await realpath(path)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return { note, path, folder };
  }
  private async load(path: string, name: string) {
    try { const result = stateSchema.parse(JSON.parse(await readFile(path, 'utf8'))); if (result.name !== name) throw new Error('笔记不匹配'); return result; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 as const, name }; throw new Error('Pages 缓存损坏，原文件已保留'); }
  }
  async read(workspaceId: string, name: string): Promise<PagesPreview> { const { note, path } = await this.scope(workspaceId, name); const data = await this.load(path, name); return { ...data, ...(note.title?{localTitle:note.title}:{}), localChanged: !!data.cache && data.cache.sourceRevision !== note.revision }; }
  private async mutate<T>(workspaceId: string, name: string, action: (state: z.infer<typeof stateSchema>, revision: string) => T) {
    const scope = await this.scope(workspaceId, name); const lockPath = scope.path + '.lock'; const deadline = Date.now() + 5000;
    let lock; while (!lock) { try { lock = await open(lockPath, 'wx', 0o600); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (Date.now() > deadline) throw new Error('Pages 缓存正在更新，请稍后重试'); await new Promise(r => setTimeout(r, 50)); } }
    const temporary = scope.path + '.' + randomUUID() + '.tmp';
    try {
      const state = await this.load(scope.path, name); const revision = (await this.library.readNote(workspaceId, name)).revision; const result = action(state, revision);
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await renameWithRetry(temporary, scope.path); return result;
    } finally { await unlink(temporary).catch(() => undefined); await lock.close(); await unlink(lockPath).catch(() => undefined); }
  }
  async begin(workspaceId: string, name: string, intent: 'create' | 'refresh', reference?: string): Promise<PagesRequest> {
    return this.mutate(workspaceId, name, (state, sourceRevision) => {
      if (intent === 'create' && state.cache) throw new Error('笔记已关联 Pages，请打开原页面编辑或同步关联');
      const target = intent === 'refresh' ? pageReference(reference || state.cache?.pageId || '') : undefined;
      if (state.request?.status === 'pending') {
        if (state.request.intent === intent && state.request.pageId === target?.pageId && state.request.sourceRevision === sourceRevision) return state.request;
        throw new Error('已有同步请求待完成；请先完成或取消它');
      }
      state.request = { id: randomUUID(), intent, sourceRevision, createdAt: new Date().toISOString(), status: 'pending', ...target }; return state.request;
    });
  }
  async task(workspaceId: string, name: string, requestId: string) {
    const state = await this.read(workspaceId, name); if (state.request?.id !== requestId || state.request.status !== 'pending') throw new Error('请求已失效或属于另一篇笔记');
    const note = await this.library.readNote(workspaceId, name); if (note.revision !== state.request.sourceRevision) throw new Error('本机笔记已更改，请取消旧请求后重试');
    return { request: state.request, name, ...(state.request.intent === 'create' ? { markdown: note.text } : {}) };
  }
  async delivery(workspaceId: string, name: string, requestId: string, mode: 'sent' | 'draft' | 'manual') { return this.mutate(workspaceId, name, state => { if (state.request?.id !== requestId) throw new Error('请求不匹配'); state.request.delivery = mode; return state.request; }); }
  async complete(workspaceId: string, name: string, requestId: string, input: Payload) {
    const value = PagePayloadSchema.parse(input); const reference = pageReference(value.url); if (reference.pageId !== value.pageId) throw new Error('页面 ID 与链接不匹配');
    if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new Error('Pages 缓存不能超过 2 MB');
    if (new Set(value.blocks.map(b => b.id)).size !== value.blocks.length) throw new Error('页面块 ID 重复');
    const normalized = { ...value, ...reference }; const resultHash = digest(JSON.stringify(normalized));
    return this.mutate(workspaceId, name, state => {
      const request = state.request; if (!request || request.id !== requestId) throw new Error('请求已失效或属于另一篇笔记');
      if (request.status === 'completed' && request.resultHash === resultHash) return state.cache!;
      if (request.status !== 'pending') throw new Error('请求已结束，不能覆盖缓存');
      if (request.pageId && request.pageId !== value.pageId) throw new Error('返回了另一页面的内容');
      if (state.cache?.pageId === value.pageId && state.cache.sequence !== undefined && value.sequence !== undefined && value.sequence < state.cache.sequence) throw new Error('不能用旧版本覆盖缓存');
      state.cache = { ...normalized, syncedAt: new Date().toISOString(), sourceRevision: request.sourceRevision }; request.status = 'completed'; request.resultHash = resultHash; delete request.error; return state.cache;
    });
  }
  async fail(workspaceId: string, name: string, requestId: string, error: string) { return this.mutate(workspaceId, name, state => { if (state.request?.id !== requestId || state.request.status !== 'pending') throw new Error('请求已结束或不匹配'); state.request.status = 'failed'; state.request.error = error.slice(0, 500); return state.request; }); }
}
