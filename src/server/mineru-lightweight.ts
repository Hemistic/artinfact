import { readFile, writeFile, mkdir, unlink, open } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { MineruPipeline, MineruStartSchema, MineruOptionsSchema, type MineruConfigSchema } from './mineru.js';
import type { PdfStateStore } from './pdf-store.js';
import type { AnalysisStatus, PageMetric } from '../shared/mineru.js';
import { resolveReferences } from '../shared/pdf-references.js';
import { renameWithRetry } from './atomic-rename.js';
import { isolatedPdfTask } from './pdf-process.js';
import { MineruLightClient } from './mineru-light-client.js';
import { LIGHT_LIMITS, mergeLightMarkdown, type LightPdfPart } from './mineru-light-split.js';

type Client = Pick<MineruLightClient, 'create' | 'upload' | 'query' | 'download'> & { close?(): void };
type Part = { startPage: number; endPage: number; file: string; markdown: string; taskId?: string; uploadUrl?: string; createAttempted?: boolean; uploaded?: boolean; completed?: boolean };
type LightJob = AnalysisStatus & { token: string; engine: 'lightweight'; name: string; size: number; pages: PageMetric[]; options: z.infer<typeof MineruOptionsSchema>; directory: string; parts?: Part[]; offset: number; updatedAt: string };
type Dependencies = { client?: Client; split?: (bytes: Buffer, pages: number) => Promise<LightPdfPart[]>; pollMs?: number };
const wait = (ms: number) => new Promise<void>(ok => { const timer = setTimeout(ok, ms); timer.unref(); });

// Keep the original structured-reader implementation available for existing results.
export class LightweightMineruPipeline extends MineruPipeline {
  private localUploads = new Map<string, { job: LightJob; bytes: Buffer }>();
  private scheduled = new Map<string, Promise<void>>();
  private queue = Promise.resolve();
  private mutations = Promise.resolve();
  private disk = Promise.resolve();
  private closed = false;
  private client: Client;
  constructor(private localStore: PdfStateStore, private dependencies: Dependencies = {}) { super(localStore); this.client = dependencies.client ?? new MineruLightClient(); }
  private folderFor(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('文档编号无效'); return this.localStore.mineruFolder(id); }
  private diskTask<T>(action: () => Promise<T>) { const next = this.disk.then(action, action); this.disk = next.then(() => undefined, () => undefined); return next; }
  private async atomicLight(path: string, value: unknown) {
    return this.diskTask(async () => {
    await mkdir(resolve(path, '..'), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await renameWithRetry(temp, path); } finally { await unlink(temp).catch(() => undefined); }
    });
  }
  private async loadLight(id: string): Promise<LightJob | undefined> {
    try {
      const job = JSON.parse(await this.diskTask(() => readFile(join(this.folderFor(id), 'job.json'), 'utf8')));
      const rel = relative(resolve(this.folderFor(id)), resolve(job.directory));
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || job.documentId !== id) throw new Error('转换任务超出文档目录');
      if (job.engine === 'lightweight' && job.parts?.some((p: Part) => !/^part-\d+\.pdf$/.test(p.file) || !/^part-\d+\.md$/.test(p.markdown))) throw new Error('PDF 分段存档路径无效');
      return job;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  }
  private async saveLight(job: LightJob, replace = false) {
    const current = await this.loadLight(job.documentId);
    if (!replace && current && current.token !== job.token) throw new Error('此转换任务已替换');
    job.updatedAt = new Date().toISOString(); await this.atomicLight(join(this.folderFor(job.documentId), 'job.json'), job);
  }
  private summary(job: LightJob): AnalysisStatus {
    const { documentId, token, phase, label, engine, taskId, segments, upstreamState, upstreamCheckedAt, submittedAt, uploadedAt, uploadStatus, uploadedBytes, warning, updatedAt, error, stats } = job;
    return { documentId, token, phase, label, engine, taskId, segments, upstreamState, upstreamCheckedAt, submittedAt, uploadedAt, uploadStatus, uploadedBytes, warning, updatedAt, error, stats, modelVersion: 'pipeline' };
  }
  private exclusive<T>(action: () => Promise<T>) { const next = this.mutations.then(action, action); this.mutations = next.then(() => undefined, () => undefined); return next; }
  async settings() { return { baseUrl: 'https://mineru.net', hasClientKey: false, engine: 'lightweight', automaticSplitting: true, maxPartPages: LIGHT_LIMITS.maxPages, maxPartBytes: LIGHT_LIMITS.maxBytes }; }
  async configure(_input: z.infer<typeof MineruConfigSchema>): Promise<Awaited<ReturnType<MineruPipeline['configure']>>> { throw new Error('当前使用 MinerU 官方轻量接口，无需 Server 地址或 Client Key'); }
  async status(id: string): Promise<AnalysisStatus> {
    const job = await this.loadLight(id); if (!job) return { documentId: id, phase: 'idle', engine: 'lightweight' };
    if (job.engine !== 'lightweight') {
      if (job.phase === 'completed') return { ...this.summary(job), engine: 'precision', label: '已有解析结果，可用于知识图谱' };
      return { documentId: id, phase: 'failed', engine: 'precision', label: '旧完整解析任务已停用', error: '已切换轻量解析，请重新转换；旧任务和已有产物已保留。' };
    }
    if (job.phase === 'receiving' && !this.localUploads.has(job.token)) return { ...this.summary(job), phase: 'failed', error: '本机 PDF 传输中断，请重新转换' };
    if (!['receiving', 'completed', 'failed'].includes(job.phase)) this.enqueue(job);
    return this.summary(job);
  }
  private async make(input: z.input<typeof MineruStartSchema>) {
    const args = MineruStartSchema.parse(input);
    if (/[\\/\u0000-\u001f]/.test(args.name) || !/\.pdf$/i.test(args.name)) throw new Error('无效的 PDF 文件名');
    const old = await this.loadLight(args.documentId);
    if (old?.engine === 'lightweight' && !['completed', 'failed'].includes((await this.status(args.documentId)).phase)) throw new Error('当前 PDF 正在转换，请等待完成');
    if (old) await this.atomicLight(join(old.directory, 'saved-job.json'), old);
    if (old?.engine === 'lightweight' && old.phase === 'failed' && old.parts?.length && old.options.language === (args.options?.language ?? 'en') && old.options.isOcr === (args.options?.isOcr ?? false)) {
      for (const part of old.parts) if (!part.completed && ((!part.taskId && part.createAttempted) || (old.upstreamState === 'failed' && old.taskId === part.taskId))) {
        delete part.taskId; delete part.uploadUrl; delete part.uploaded; delete part.createAttempted;
      }
      delete old.error; delete old.upstreamState; old.phase = 'receiving'; old.offset = 0; old.label = '准备继续轻量解析'; return old;
    }
    const token = randomUUID(), directory = join(this.folderFor(args.documentId), 'runs', token);
    await mkdir(join(directory, 'output'), { recursive: true });
    return { ...args, token, directory, engine: 'lightweight', offset: 0, options: { ...MineruOptionsSchema.parse(args.options ?? {}), modelVersion: 'pipeline' }, phase: 'receiving', label: '准备轻量解析', updatedAt: new Date().toISOString() } as LightJob;
  }
  async start(input: z.input<typeof MineruStartSchema>) {
    return this.exclusive(async () => {
      if (this.localUploads.size >= 2) throw new Error('请等待当前 PDF 传输完成');
      const job = await this.make(input); this.localUploads.set(job.token, { job, bytes: Buffer.alloc(job.size) }); await this.saveLight(job, true);
      return this.summary(job) as AnalysisStatus & { token: string };
    });
  }
  upload(token: string, offset: number, data: string) {
    const entry = this.localUploads.get(token); if (!entry || entry.job.offset !== offset) throw new Error('PDF 传输任务或片段顺序无效');
    if (data.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('PDF 片段无效');
    const bytes = Buffer.from(data, 'base64'); if (!bytes.length || offset + bytes.length > entry.bytes.length) throw new Error('PDF 片段范围无效');
    bytes.copy(entry.bytes, offset); entry.job.offset += bytes.length;
  }
  private verify(job: { documentId: string; size: number }, bytes: Buffer) { if (bytes.length !== job.size || createHash('sha256').update(bytes).digest('hex') !== job.documentId || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF 内容与当前文档不匹配'); }
  async run(token: string) {
    const entry = this.localUploads.get(token); if (!entry || entry.job.offset !== entry.bytes.length) throw new Error('PDF 尚未完整传输');
    this.verify(entry.job, entry.bytes); await writeFile(join(entry.job.directory, 'source.pdf'), entry.bytes, { mode: 0o600 }); this.localUploads.delete(token);
    entry.job.phase = 'creating'; entry.job.label = '等待本机轻量转换'; await this.saveLight(entry.job); this.enqueue(entry.job); return this.summary(entry.job);
  }
  async startBatch(items: Array<z.input<typeof MineruStartSchema> & { sourcePath: string }>, control: { restartQueued?: boolean; reconvertCompleted?: boolean } = {}) {
    return this.exclusive(async () => {
      if (!items.length || items.length > 200 || new Set(items.map(i => i.documentId)).size !== items.length) throw new Error('PDF 数量无效或存在重复');
      const jobs: AnalysisStatus[] = [], skipped: AnalysisStatus[] = [];
      for (const item of items) {
        const prior = await this.status(item.documentId);
        if (!['idle', 'failed'].includes(prior.phase) && !(control.reconvertCompleted && prior.phase === 'completed')) { skipped.push(prior); continue; }
        if (prior.phase === 'completed') await this.scheduled.get(item.documentId);
        const bytes = await readFile(item.sourcePath); this.verify(item, bytes);
        const job = await this.make(item); await writeFile(join(job.directory, 'source.pdf'), bytes, { mode: 0o600 });
        job.offset = bytes.length; job.phase = 'creating'; job.label = '等待本机轻量转换'; await this.saveLight(job, true); this.enqueue(job); jobs.push(this.summary(job));
      }
      return { jobs, skipped };
    });
  }
  private enqueue(job: LightJob) {
    if (this.closed || this.scheduled.has(job.documentId)) return;
    const work = this.queue.then(() => this.execute(job)); this.scheduled.set(job.documentId, work);
    this.queue = work.catch(() => undefined).finally(() => this.scheduled.delete(job.documentId));
  }
  private async execute(initial: LightJob) {
    if (this.closed) return;
    const lockPath = join(initial.directory, 'light-run.lock'); let lock;
    try { lock = await open(lockPath, 'wx'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { const { pid } = JSON.parse(await readFile(lockPath, 'utf8')); process.kill(pid, 0); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; await unlink(lockPath).catch(() => undefined); }
      try { lock = await open(lockPath, 'wx'); } catch { return; }
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    let job = initial;
    try {
      const stored = await this.loadLight(job.documentId); if (!stored || stored.token !== job.token) return; job = stored;
      if (!job.parts) {
        job.label = '检查并拆分 PDF'; await this.saveLight(job);
        const bytes = await readFile(join(job.directory, 'source.pdf')); this.verify(job, bytes);
        const split = this.dependencies.split ?? (async (data: Buffer, pages: number) => pages <= LIGHT_LIMITS.maxPages && data.length <= LIGHT_LIMITS.maxBytes ? [{ startPage: 1, endPage: pages, bytes: data }] : (await isolatedPdfTask(new URL('../../dist/server/pdf-split-worker.js', import.meta.url), { bytes: Uint8Array.from(data).buffer, pages }, 120000)).parts);
        const parts = await split(bytes, job.pages.length); job.parts = [];
        let page = 1;
        for (const [index, part] of parts.entries()) {
          if (part.startPage !== page || part.endPage < page || part.endPage - page + 1 > LIGHT_LIMITS.maxPages || part.bytes.length > LIGHT_LIMITS.maxBytes) throw new Error('PDF 拆分结果缺页或超过接口限制');
          page = part.endPage + 1;
          const file = `part-${index + 1}.pdf`, markdown = `part-${index + 1}.md`;
          await writeFile(join(job.directory, file), part.bytes, { mode: 0o600 }); job.parts.push({ startPage: part.startPage, endPage: part.endPage, file, markdown });
        }
        if (page !== job.pages.length + 1) throw new Error('PDF 拆分未覆盖全文');
        await this.saveLight(job);
      }
      for (const [index, part] of job.parts.entries()) {
        if (this.closed) return;
        if (part.completed) continue;
        job.segments = { completed: index, total: job.parts.length, startPage: part.startPage, endPage: part.endPage };
        const suffix = `第 ${index + 1}/${job.parts.length} 段 · 原文 ${part.startPage}–${part.endPage} 页`;
        let newlyCreated = false;
        if (!part.taskId) {
          if (part.createAttempted) throw new Error('上次提交结果不明确，已停止自动重复提交；请检查任务后重试。');
          part.createAttempted = true; job.phase = 'creating'; job.label = `创建轻量任务 · ${suffix}`; await this.saveLight(job);
          const name = job.parts.length > 1 ? job.name.replace(/\.pdf$/i, `-p${part.startPage}-${part.endPage}.pdf`) : job.name;
          const created = await this.client.create(name, job.options); Object.assign(part, created); newlyCreated = true;
          job.taskId = part.taskId; job.submittedAt = new Date().toISOString(); await this.saveLight(job);
        }
        job.taskId = part.taskId;
        if (!part.uploaded) {
          if (!part.uploadUrl) throw new Error('轻量任务上传地址丢失');
          const previous = newlyCreated ? { state: 'waiting-file' } : await this.client.query(part.taskId!);
          if (['waiting-file', 'uploading'].includes(previous.state)) {
            job.phase = 'uploading'; job.label = `上传 PDF · ${suffix}`; await this.saveLight(job);
            const receipt = await this.client.upload(part.uploadUrl, await readFile(join(job.directory, part.file)));
            job.uploadStatus = receipt.http; job.uploadedBytes = receipt.bytes; job.uploadedAt = new Date().toISOString();
          }
          part.uploaded = true; await this.saveLight(job);
        }
        let errors = 0;
        for (;;) {
          if (this.closed) return;
          let state;
          try { state = await this.client.query(part.taskId!); errors = 0; delete job.warning; }
          catch (e) { if (++errors >= 6) throw e; job.warning = '查询暂时失败，正在重试原任务'; await this.saveLight(job); await wait(this.dependencies.pollMs ?? 3000); continue; }
          job.upstreamState = state.state; job.upstreamCheckedAt = new Date().toISOString(); job.phase = 'parsing';
          job.label = `${state.state === 'pending' ? '轻量服务排队中' : '轻量服务处理中'} · ${suffix}`; await this.saveLight(job);
          if (state.state === 'failed') throw new Error(`MinerU 轻量解析失败：${state.error || state.errorCode || '未知原因'}`);
          if (state.state === 'done') {
            if (!state.markdownUrl) throw new Error('轻量任务完成但没有 Markdown 地址');
            job.phase = 'downloading'; job.label = `保存图谱资料 · ${suffix}`; await this.saveLight(job);
            const text = await this.client.download(state.markdownUrl); if (!text.trim()) throw new Error('Markdown 分段为空');
            await writeFile(join(job.directory, part.markdown), text, { mode: 0o600 }); part.completed = true; delete part.uploadUrl; await this.saveLight(job); break;
          }
          await wait(this.dependencies.pollMs ?? 3000);
        }
      }
      if (this.closed) return;
      job.phase = 'indexing'; job.label = '按原页序合并图谱资料'; await this.saveLight(job);
      const parts = await Promise.all(job.parts.map(async p => ({ ...p, text: await readFile(join(job.directory, p.markdown), 'utf8') })));
      const md = mergeLightMarkdown(parts), directory = join(job.directory, 'output');
      await writeFile(join(directory, 'document-mineru.md'), md, { mode: 0o600 });
      await this.saveLight(job);
      await this.atomicLight(join(this.folderFor(job.documentId), 'result.json'), { directory, token: job.token, pages: job.pages, name: job.name, format: 'markdown-only', engine: 'lightweight', segments: parts.map(p => ({ startPage: p.startPage, endPage: p.endPage })) });
      job.phase = 'completed'; job.label = '图谱资料准备完成'; job.segments = { completed: parts.length, total: parts.length }; job.stats = { characters: md.length, pages: job.pages.length, segments: parts.length }; delete job.error; await this.saveLight(job);
    } catch (e) {
      if (!this.closed) { job.phase = 'failed'; job.error = String(e instanceof Error ? e.message : e).replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(0, 500); await this.saveLight(job).catch(() => undefined); }
    } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
  }
  async layout(id: string) { const result = await this.result(id); return result.format === 'markdown-only' ? (await this.localStore.read(id)).annotations.filter(a => a.projectOrigin === 'layout-json') : super.layout(id); }
  async references(id: string, text: string, citationTexts: string[] = [], citationNumbers: string[] = []) {
    let result; try { result = await this.result(id); } catch { return super.references(id, text, citationTexts, citationNumbers); }
    return result.format === 'markdown-only' ? resolveReferences(text, new Map(), citationTexts, citationNumbers) : super.references(id, text, citationTexts, citationNumbers);
  }
  async read(_id: string, _kind: 'markdown' | 'json' | 'bundle', _offset: number, _length: number): Promise<{ offset: number; total: number; data: string }> { throw new Error('Markdown 仅用于知识图谱，暂不支持直接导出'); }
  async close() { this.closed = true; this.client.close?.(); this.localUploads.clear(); await this.queue; await super.close(); }
}
