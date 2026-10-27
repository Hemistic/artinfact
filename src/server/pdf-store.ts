import {readFileSnapshot,primeFileSnapshot} from './file-snapshot.js';
import {renameWithRetry} from './atomic-rename.js';
import { mkdir, readFile, writeFile, open, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const annotation = z.object({ id: z.string().min(1).max(100) }).loose();
const record = z.record(z.string(), z.unknown());
export const PdfPatchSchema = z.object({
  annotations: z.array(annotation).max(10000).optional(),
  deletedIds: z.array(z.string().min(1).max(100)).max(10000).optional(),
  viewState: record.optional(),
  sidebar: z.object({ open: z.boolean(), view: z.enum(['annotations', 'outline', 'thumbnails', 'pdfs']) }).optional(),
});
const StateSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), annotations: z.array(annotation), viewState: record.optional(), sidebar: z.object({ open: z.boolean(), view: z.enum(['annotations', 'outline', 'thumbnails', 'pdfs']) }).optional(), aiOutline: record.nullable().optional(), aiInsightMeta: record.nullable().optional() });
export type PdfState = z.infer<typeof StateSchema>;
export type PdfPatch = z.infer<typeof PdfPatchSchema>;
export class PdfStateStore {
  constructor(readonly root: string, readonly projectLayout = false) {}
  mineruFolder(id: string) { this.path(id); return this.projectLayout ? join(this.root, id, 'mineru') : join(this.root, 'mineru', id); }
  private path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的 PDF 文档标识');
    return this.projectLayout ? join(this.root, id, 'state.json') : join(this.root, `${id}.json`);
  }
  async read(id: string): Promise<PdfState> {
    const path = this.path(id);
    try { return structuredClone(await readFileSnapshot(path,'pdf-state-v1',text=>StateSchema.parse(JSON.parse(text)))); }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,revision:0,annotations:[]};if(error instanceof SyntaxError||error instanceof z.ZodError)throw new Error('批注存档损坏，已保留原文件。请备份后检查存档。');throw error; }
  }

  async update(id: string, input: PdfPatch): Promise<PdfState> {
    const patch = PdfPatchSchema.parse(input);
    if (JSON.stringify(patch).length > 24 * 1024 * 1024) throw new Error('批注数据过大');
    return this.commit(id, state => {
      const annotations = new Map(state.annotations.map(value => [value.id, value]));
      for (const value of patch.annotations ?? []) { const merged = { ...annotations.get(value.id), ...value }; delete merged.onlyTextOrComment; annotations.set(value.id, merged); }
      for (const value of patch.deletedIds ?? []) annotations.delete(value);
      return { ...state, annotations: [...annotations.values()], ...(patch.viewState ? { viewState: patch.viewState } : {}), ...(patch.sidebar ? { sidebar: patch.sidebar } : {}) };
    });
  }
  async addReferenceContribution(id:string,value:Record<string,unknown>):Promise<PdfState>{
    const next=annotation.parse(value);
    if(next.projectOrigin!=='reference-contribution'||typeof next.referenceTaskId!=='string'||typeof next.comment!=='string')throw Error('引用贡献批注无效');
    return this.commit(id,state=>{if(state.annotations.some(a=>a.id===next.id))throw Error('批注标识已存在，未覆盖原批注');return {...state,annotations:[...state.annotations,next],sidebar:{open:true,view:'annotations'}};});
  }
  async updateResearch(id: string, input: { aiOutline?: Record<string, unknown> | null; aiInsights?: { id: string; [key: string]: unknown }[]; aiInsightMeta?: Record<string, unknown> | null }): Promise<PdfState> {
    const patch = z.object({ aiOutline: record.nullable().optional(), aiInsights: z.array(annotation).max(96).optional(), aiInsightMeta: record.nullable().optional() }).strict().parse(input);
    return this.commit(id, state => {
      const kept = state.annotations.filter(a => !['innovation', 'evidence'].includes(String(a.aiInsightKind)));
      const ids = new Set(kept.map(a => a.id));
      if (patch.aiInsights) for (const a of patch.aiInsights) { if (ids.has(a.id) || !['innovation', 'evidence'].includes(String(a.aiInsightKind))) throw new Error('AI 批注标识冲突或类型无效'); ids.add(a.id); }
      return { ...state, ...(patch.aiOutline !== undefined ? { aiOutline: patch.aiOutline } : {}), ...(patch.aiInsightMeta !== undefined ? { aiInsightMeta: patch.aiInsightMeta } : {}), ...(patch.aiInsights ? { annotations: [...kept, ...patch.aiInsights] } : {}) };
    });
  }
  private async commit(id: string, transform: (state: PdfState) => PdfState): Promise<PdfState> {
    const path = this.path(id);
    await mkdir(dirname(path), { recursive: true });
    const lockPath = `${path}.lock`;
    const deadline = Date.now() + 6000;
    let lock;
    while (!lock) {
      try { lock = await open(lockPath, 'wx'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // An interrupted local write may leave a lock, but a live write is never evicted.
        const age = await stat(lockPath).then(value => Date.now() - value.mtimeMs, () => 0);
        if (age > 60000) { await unlink(lockPath).catch(() => undefined); continue; }
        if (Date.now() > deadline) throw new Error('批注正在由其他窗口保存，请稍后重试');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const state = await this.read(id);
      const next = StateSchema.parse({ ...transform(state), revision: state.revision + 1 });
      const json = JSON.stringify(next, null, 2);
      if (json.length > 32 * 1024 * 1024) throw new Error('批注存档超过 32 MB');
      await writeFile(temporary, json, 'utf8');
      await renameWithRetry(temporary, path);
      await primeFileSnapshot(path,'pdf-state-v1',next,Buffer.byteLength(json));
      return structuredClone(next);
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
