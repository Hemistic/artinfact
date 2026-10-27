import { isolatedPdfTask } from './pdf-process.js';
import { createHash, randomUUID } from 'node:crypto';
import type { PdfStateStore } from './pdf-store.js';

const MAX_BYTES = 64 * 1024 * 1024;
type Job = { id: string; bytes: Buffer; offset: number; expires: number; output?: Buffer; running?: boolean };
export class PdfExporter {
  private jobs = new Map<string, Job>();
  constructor(private store: PdfStateStore, private workerUrl = new URL('./pdf-export-worker.js', import.meta.url)) {}
  private find(token: string) {
    const job = this.jobs.get(token);
    if (!job || (!job.running && job.expires < Date.now())) { this.jobs.delete(token); throw new Error('导出任务不存在或已过期，请重新导出'); }
    job.expires = Date.now() + 120000;
    return job;
  }
  start(id: string, size: number) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的 PDF 文档标识');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw new Error('PDF 不能超过 64 MB');
    for (const [token, job] of this.jobs) if (!job.running && job.expires < Date.now()) this.jobs.delete(token);
    if (this.jobs.size >= 2) throw new Error('已有导出任务，请等待完成后重试');
    const token = randomUUID(); this.jobs.set(token, { id, bytes: Buffer.alloc(size), offset: 0, expires: Date.now() + 120000 });
    return token;
  }
  upload(token: string, offset: number, data: string) {
    const job = this.find(token);
    if (job.running || job.output || offset !== job.offset) throw new Error('PDF 片段顺序错误');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || data.length > 1024 * 1024) throw new Error('无效的 PDF 片段');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || offset + bytes.length > job.bytes.length) throw new Error('PDF 片段范围错误');
    bytes.copy(job.bytes, offset); job.offset += bytes.length;
  }
  async finish(token: string) {
    const job = this.find(token);
    if (job.running || job.output || job.offset !== job.bytes.length) throw new Error('PDF 片段尚未完整上传');
    if (!job.bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')) || createHash('sha256').update(job.bytes).digest('hex') !== job.id) { this.jobs.delete(token); throw new Error('PDF 内容与批注存档不匹配'); }
    job.running = true;
    try {
      const state = await this.store.read(job.id);
      const bytes = Uint8Array.from(job.bytes).buffer;
      const value = await isolatedPdfTask(this.workerUrl, { bytes, annotations: state.annotations }, 90000);
      if (!(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength > 128 * 1024 * 1024) throw new Error('PDF 导出结果无效');
      const output = value.bytes;
      job.output = Buffer.from(output); job.bytes = Buffer.alloc(0); job.running = false; job.expires = Date.now() + 120000;
      return job.output.length;
    } catch (error) { this.jobs.delete(token); throw error; }
  }
  read(token: string, offset: number, length: number) {
    const output = this.find(token).output;
    if (!output) throw new Error('PDF 尚未导出完成');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= output.length || !Number.isSafeInteger(length) || length < 1 || length > 768 * 1024) throw new Error('无效的导出读取范围');
    return { offset, total: output.length, data: output.subarray(offset, offset + length).toString('base64') };
  }
  release(token: string) { if (this.jobs.get(token)?.running) throw new Error('PDF 正在生成'); this.jobs.delete(token); }
}
