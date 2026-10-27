import {UiLanguageStore} from './ui-language.js';
import { isolatedPdfTask } from './pdf-process.js';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, link, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import type { WorkspaceRuntime } from './workspace-runtime.js';
import { renameWithRetry } from './atomic-rename.js';
import {readFileSnapshot} from './file-snapshot.js';
import {researchArtifactsFingerprint} from './research-artifacts.js';
type Operation = 'context' | 'inspect' | 'brief' | 'prepare' | 'write' | 'clear';
export type ResearchScope = 'outline' | 'insights';
async function atomic(path: string, value: unknown) { const tmp = `${path}.${randomUUID()}.tmp`; try { await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await renameWithRetry(tmp, path); } finally { await unlink(tmp).catch(() => undefined); } }
export class ResearchAI {
  private tails = new Map<string, Promise<unknown>>();
  constructor(readonly runtime: WorkspaceRuntime) {}
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> { const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn); this.tails.set(key, result); void result.finally(() => { if (this.tails.get(key) === result) this.tails.delete(key); }).catch(() => undefined); return result; }
  private async run(workspaceId: string, documentId: string, operation: Operation, input?: unknown, scope?: string): Promise<any> {
    const document = await this.runtime.library.document(workspaceId, documentId); const runtime = await this.runtime.scope(workspaceId, documentId); const state = await runtime.store.read(documentId); const result = await runtime.mineru.result(documentId);
    if (!result && operation !== 'clear') throw new Error('请先完成此 PDF 的 MinerU Markdown 转换');
    if (operation !== 'clear') await researchArtifactsFingerprint(result);
    const root = await mkdtemp(join(document.projectDir, '.research-')); const project = join(root, documentId); await mkdir(join(project, 'mineru'), { recursive: true });
    try {
      await link(document.sourcePath, join(project, 'source.pdf')).catch(() => copyFile(document.sourcePath, join(project, 'source.pdf')));
      if (result) { await copyFile(join(result.directory, 'document-mineru.json'), join(project, 'mineru', 'document-mineru.json')); await copyFile(join(result.directory, 'document-mineru.md'), join(project, 'mineru', 'document-mineru.md')); }
      // Original Electron validation runs against an isolated snapshot; it never writes the user's state file.
      await writeFile(join(project, 'state.json'), JSON.stringify({ ...state, projectID: documentId, documentTitle: document.title || document.name, documentAuthor: document.author, sourcePath: join(project, 'source.pdf'), mineruArtifacts: { jsonPath: join(project, 'mineru', 'document-mineru.json'), markdownPath: join(project, 'mineru', 'document-mineru.md'), outputDir: join(project, 'mineru') } }));
      const value = (await isolatedPdfTask(new URL('./research-worker.js', import.meta.url), { root, documentId, operation, input, scope,language:(input as any)?.aiOutline?.language??(input as any)?.aiInsightMeta?.language??await new UiLanguageStore(this.runtime.legacyStore.root).read() }, 110000)).value;
      const replace = (v: any): any => typeof v === 'string' ? v.replaceAll(join(project, 'mineru'), result?.directory ?? runtime.store.mineruFolder(documentId)).replaceAll(project, document.projectDir).replaceAll(root, (awaitRoot)) : Array.isArray(v) ? v.map(replace) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k, replace(v)])) : v;
      const awaitRoot = (await this.runtime.library.get(workspaceId)).rootDir;
      return replace(value);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  async read(workspaceId:string,documentId:string){
   const [{store},document]=await Promise.all([this.runtime.scope(workspaceId,documentId),this.runtime.library.document(workspaceId,documentId)]);
   const [state,entries]=await Promise.all([store.read(documentId),Promise.all(['outline','insights'].map(async scope=>{try{return [scope,await readFileSnapshot(join(document.projectDir,`research-${scope}.json`),'research-job',JSON.parse)] as const;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return undefined;}}))]);
   const jobs:Record<string,unknown>=Object.fromEntries(entries.filter((entry):entry is NonNullable<typeof entry>=>!!entry));
   const aiOutline=state.aiOutline??null,aiInsights=state.annotations.filter(a=>['innovation','evidence'].includes(String(a.aiInsightKind))),aiInsightMeta=state.aiInsightMeta??null;
   // Scrolling and manual annotations change the PDF revision, not the AI payload.
   const snapshotRevision=createHash('sha256').update(JSON.stringify([aiOutline,aiInsights,aiInsightMeta,jobs])).digest('hex');
   return{revision:state.revision,snapshotRevision,aiOutline,aiInsights,aiInsightMeta,jobs};
  }
  async updates(workspaceId:string,documentId:string,knownSnapshotRevision?:string){const value=await this.read(workspaceId,documentId);return knownSnapshotRevision===value.snapshotRevision?{unchanged:true,snapshotRevision:value.snapshotRevision}:value;}
  async context(workspaceId:string,documentId:string){return this.run(workspaceId,documentId,'context');}
  async source(workspaceId: string, documentId: string, operation: 'inspect' | 'brief') { return this.run(workspaceId, documentId, operation); }
  async prepare(workspaceId: string, documentId: string, input: Record<string, unknown>) { this.candidate(input); return this.run(workspaceId, documentId, 'prepare', input); }
  private candidate(input: Record<string, unknown>) { if (Object.keys(input).some(k => !['aiOutline', 'aiInsights', 'aiInsightMeta'].includes(k)) || (!input.aiOutline && !Array.isArray(input.aiInsights))) throw new Error('请提供 AI 大纲或洞察候选'); if ('aiOutline' in input && (!input.aiOutline || (input.aiOutline as any).status === 'cleared')) throw new Error('清除大纲请使用指定清除操作'); if (Array.isArray(input.aiInsights) && input.aiInsights.length === 0) throw new Error('生成任务不能提交空洞察；清除请使用指定操作'); if ('aiInsightMeta' in input && !('aiInsights' in input)) throw new Error('洞察元数据必须随洞察一起写入'); }
  async begin(workspaceId: string, documentId: string, scope: ResearchScope, instructions?:string) { return this.serial(`${workspaceId}/${documentId}`, async () => {
    const document = await this.runtime.library.document(workspaceId, documentId); const result = await (await this.runtime.scope(workspaceId, documentId)).mineru.result(documentId); if (!result) throw new Error('请先完成 MinerU 转换');
    const sourceFingerprint = await researchArtifactsFingerprint(result);
    const existing = (await this.read(workspaceId, documentId)).jobs[scope] as any;
    if (existing?.status === 'queued' && Date.now() - Date.parse(existing.createdAt) < 20 * 60000) {
        if (['prepared', 'draft', 'manual'].includes(existing.delivery) && existing.sourceFingerprint === sourceFingerprint && existing.instructions===instructions) return existing;
      throw new Error('此项分析已发送到当前聊天，请等待完成或取消后重试');
    }
      const job = { id: randomUUID(), outputLanguage:await new UiLanguageStore(this.runtime.legacyStore.root).read(), scope, instructions, status: 'queued', delivery: 'prepared', createdAt: new Date().toISOString(), sourceFingerprint }; await atomic(join(document.projectDir, `research-${scope}.json`), job); return job;
  }); }
  async delivery(workspaceId: string, documentId: string, jobId: string, mode: 'sent' | 'draft' | 'manual') { return this.serial(`${workspaceId}/${documentId}`, async () => {
    const doc = await this.runtime.library.document(workspaceId, documentId); const jobs = (await this.read(workspaceId, documentId)).jobs;
    const job = Object.values(jobs).find((value: any) => value.id === jobId) as any;
    if (!job) throw new Error('分析任务已替换');
    if (job.status !== 'queued') return job;
    const next = { ...job, delivery: mode }; await atomic(join(doc.projectDir, `research-${job.scope}.json`), next); return next;
  }); }
  async finish(workspaceId: string, documentId: string, jobId: string, error: string, cancelled=false) { return this.serial(`${workspaceId}/${documentId}`, async () => { const doc = await this.runtime.library.document(workspaceId, documentId); const jobs = (await this.read(workspaceId, documentId)).jobs; const job = Object.values(jobs).find((j: any) => j.id === jobId) as any; if (!job || job.status !== 'queued') throw new Error('分析任务已结束或已替换'); await atomic(join(doc.projectDir, `research-${job.scope}.json`), { ...job, status: cancelled?'cancelled':'failed', error: error.slice(0, 500), finishedAt: new Date().toISOString() }); return {}; }); }
  async write(workspaceId: string, documentId: string, input: Record<string, unknown>, jobId?: string) { this.candidate(input); return this.serial(`${workspaceId}/${documentId}`, async () => {
    const doc = await this.runtime.library.document(workspaceId, documentId); const scope = await this.runtime.scope(workspaceId, documentId); const before = await scope.mineru.result(documentId); const data = await this.read(workspaceId, documentId); const job = Object.values(data.jobs).find((j: any) => j.id === jobId) as any;
    const sourceFingerprint = await researchArtifactsFingerprint(before);
    if (jobId && (!job || job.status !== 'queued' || job.sourceFingerprint !== sourceFingerprint || (job.scope === 'outline' ? !input.aiOutline || 'aiInsights' in input : !input.aiInsights || 'aiOutline' in input))) throw new Error('分析任务或资料已变化，请重新生成');
    const prepared = await this.run(workspaceId, documentId, 'write', input); if (!prepared.valid) return prepared;
    await this.runtime.library.document(workspaceId, documentId);
    if (sourceFingerprint !== await researchArtifactsFingerprint(await scope.mineru.result(documentId))) throw new Error('解析资料已更新，请重新生成');
    const value = prepared.result; const patch = { ...('aiOutline' in input ? { aiOutline: value.aiOutline } : {}), ...('aiInsights' in input ? { aiInsights: value.aiInsights, aiInsightMeta: value.aiInsightMeta } : {}) };
    await scope.store.updateResearch(documentId, patch); if (job) await atomic(join(doc.projectDir, `research-${job.scope}.json`), { ...job, status: 'completed', finishedAt: new Date().toISOString() }); return { valid: true, diagnostics: prepared.diagnostics, ...await this.read(workspaceId, documentId) };
  }); }
  async clear(workspaceId: string, documentId: string, scope: 'outline' | 'insights' | 'all') { return this.serial(`${workspaceId}/${documentId}`, async () => { const value = await this.run(workspaceId, documentId, 'clear', undefined, scope); const runtime = await this.runtime.scope(workspaceId, documentId); await runtime.store.updateResearch(documentId, { ...(scope !== 'insights' ? { aiOutline: value.aiOutline } : {}), ...(scope !== 'outline' ? { aiInsights: [], aiInsightMeta: value.aiInsightMeta } : {}) }); const doc = await this.runtime.library.document(workspaceId, documentId); for (const s of scope === 'all' ? ['outline', 'insights'] : [scope]) await unlink(join(doc.projectDir, `research-${s}.json`)).catch(e => { if (e.code !== 'ENOENT') throw e; }); return this.read(workspaceId, documentId); }); }
}
