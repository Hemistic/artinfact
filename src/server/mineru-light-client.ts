import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { LIGHT_LIMITS } from './mineru-light-split.js';

export type LightWire = (url: URL, options: { method: 'GET' | 'POST' | 'PUT'; body?: Buffer; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; headers: Record<string, string | string[] | undefined>; bytes: Buffer }>;
const nativeWire: LightWire = (url, options) => new Promise((resolve, reject) => {
  const req = request(url, { method: options.method, agent: false, signal: options.signal, timeout: options.method === 'PUT' ? 90000 : 45000, headers: { ...options.headers, ...(options.body ? { 'Content-Length': String(options.body.length) } : {}) } }, res => {
    const parts: Buffer[] = []; let size = 0;
    res.on('data', (b: Buffer) => { size += b.length; if (size > 40 * 1024 * 1024) req.destroy(new Error('MinerU 响应过大')); else parts.push(b); });
    res.once('error', reject); res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes: Buffer.concat(parts) }));
  });
  req.once('timeout', () => req.destroy(new Error('连接 MinerU 超时'))); req.once('error', reject); req.end(options.body);
});
export type LightTask = { state: 'waiting-file' | 'uploading' | 'pending' | 'running' | 'done' | 'failed'; markdownUrl?: string; error?: string; errorCode?: string | number };
export class MineruLightClient {
  private controller = new AbortController();
  constructor(private wire: LightWire = nativeWire) {}
  close() { this.controller.abort(); }
  private asset(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.aliyuncs.com') || url.hostname.endsWith('.openxlab.org.cn'))) throw new Error('MinerU 返回了无效的资源地址');
    return url;
  }
  private async api(path: string, body?: object) {
    const r = await this.wire(new URL('/api/v1/agent/parse/' + path, 'https://mineru.net'), { method: body ? 'POST' : 'GET', ...(body ? { body: Buffer.from(JSON.stringify(body)), headers: { 'Content-Type': 'application/json' } } : {}), signal: this.controller.signal });
    let value: any; try { value = JSON.parse(r.bytes.toString('utf8')); } catch { throw new Error(`MinerU 返回非 JSON 响应（HTTP ${r.status}）`); }
    if (r.status !== 200 || value.code !== 0) throw new Error(`MinerU 轻量接口请求失败（HTTP ${r.status}，${value.code ?? '未知代码'}）：${String(value.msg ?? '').replace(/https?:\/\/\S+/g, '[URL]').slice(0, 300)}`);
    return value.data;
  }
  async create(name: string, options: { language: string; isOcr: boolean }) {
    const data = await this.api('file', { file_name: name, language: options.language, is_ocr: options.isOcr, enable_formula: true, enable_table: true });
    if (typeof data?.task_id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(data.task_id) || typeof data.file_url !== 'string') throw new Error('MinerU 未返回有效任务编号和上传地址');
    this.asset(data.file_url); return { taskId: data.task_id as string, uploadUrl: data.file_url as string };
  }
  async upload(url: string, bytes: Buffer) {
    if (bytes.length > LIGHT_LIMITS.maxBytes) throw new Error('PDF 分段超过 10 MB');
    const r = await this.wire(this.asset(url), { method: 'PUT', body: bytes, signal: this.controller.signal });
    const etag = String(r.headers.etag ?? '').replaceAll('"', '');
    const same = /^[a-f0-9]{32}$/i.test(etag) ? etag.toLowerCase() === createHash('md5').update(bytes).digest('hex') : undefined;
    if (r.status < 200 || r.status >= 300 || same === false) throw new Error(`PDF 分段上传失败（HTTP ${r.status}）`);
    return { http: r.status, bytes: bytes.length, etagMatchesMd5: same };
  }
  async query(taskId: string): Promise<LightTask> {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(taskId)) throw new Error('MinerU 任务编号无效');
    const data = await this.api(taskId);
    if (!['waiting-file', 'uploading', 'pending', 'running', 'done', 'failed'].includes(data?.state)) throw new Error('MinerU 返回未知任务状态');
    return { state: data.state, markdownUrl: data.markdown_url, error: data.err_msg, errorCode: data.err_code };
  }
  async download(url: string) {
    const r = await this.wire(this.asset(url), { method: 'GET', signal: this.controller.signal });
    const text = r.bytes.toString('utf8');
    if (r.status !== 200 || !text.trim() || /^\s*(?:<!doctype html|<html)/i.test(text)) throw new Error(`Markdown 下载失败或内容无效（HTTP ${r.status}）`);
    return text;
  }
}
