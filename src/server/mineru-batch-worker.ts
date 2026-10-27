import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withMineruRateLimit } from './mineru-rate-limit.js';
import { mineruUpstreamStatus } from '../shared/mineru-upstream-status.js';
import { withMineruQueryRetry } from './mineru-query-retry.js';
import { uploadMineruPdf } from './mineru-upload.js';
const require = createRequire(import.meta.url);
type RemoteFile = { dataId: string; uploadUrl?: string; taskId?: string; state?: string; zipUrl?: string; errMsg?: string };
type BatchClient = { createUploadBatch(args: object): Promise<{ batchId: string; files: RemoteFile[] }>; queryUploadTaskBatch(id: string): Promise<{ files: RemoteFile[] }>; uploadPdfToMineru(url: string, bytes: Buffer): Promise<void>; writeZipResult(args: object): Promise<unknown> };
const { MineruMarkdownService } = require(fileURLToPath(new URL('../../vendor/mineru/runtime/client.cjs', import.meta.url))) as { MineruMarkdownService: new (args: object) => BatchClient };
type Item = { documentId: string; name: string; filePath: string; outputPath: string; phase: string; uploadUrl?: string };
const items = workerData.items as Item[];
const progress = (documentId: string, value: object) => parentPort!.postMessage({ documentId, progress: value });
const all = (value: object) => items.forEach(i => progress(i.documentId, value));
const safe = (error: unknown) => (error instanceof Error ? error.message : String(error)).replaceAll(String(workerData.clientKey), '[redacted]').replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(0, 500);
const client = new MineruMarkdownService({ baseURL: workerData.baseUrl, clientKey: workerData.clientKey, logger: { log() {} } });
try {
  let batchId = workerData.resumeBatchId as string | undefined;
  if (!batchId) {
    all({ phase: 'creating', label: `创建 MinerU 批量任务（${items.length} 份）` });
    const batch = await withMineruRateLimit(() => client.createUploadBatch({ files: items.map(i => ({ fileName: i.name, dataId: i.documentId })), ...workerData.options }), seconds => all({ phase: 'creating', label: `Server 限流，等待 ${seconds} 秒` }));
    batchId = batch.batchId;
    const files = new Map<string, any>();
    for (const f of batch.files) { if (!f.dataId || files.has(f.dataId)) throw new Error('批量响应的 dataId 缺失或重复'); files.set(f.dataId, f); }
    if (files.size !== items.length || items.some(i => !files.get(i.documentId)?.uploadUrl)) throw new Error('批量上传响应与所选 PDF 不匹配');
    const saved = new Promise<void>(resolve => parentPort!.once('message', () => resolve()));
    parentPort!.postMessage({ created: items.map(i => ({ documentId: i.documentId, batchId, uploadUrl: files.get(i.documentId).uploadUrl, taskId: files.get(i.documentId).taskId })) });
    // Save the common batch and individual URLs before any PDF upload, so restart can resume it.
    await saved;
    for (const i of items) { i.uploadUrl = files.get(i.documentId).uploadUrl; i.phase = 'uploading'; }
  }
  const remaining = new Map(items.map(i => [i.documentId, i]));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item.phase !== 'uploading') continue;
      try {
        if (!item.uploadUrl) throw new Error('批量任务缺少此 PDF 的上传地址');
        progress(item.documentId, { phase: 'uploading', label: '上传 PDF（批量任务）' });
        const receipt = await uploadMineruPdf(item.uploadUrl, await readFile(item.filePath));
        progress(item.documentId, { ...receipt, phase: 'parsing', label: 'PDF 已上传，正在查询 MinerU 批量状态' });
      } catch (error) { remaining.delete(item.documentId); parentPort!.postMessage({ documentId: item.documentId, error: safe(error) }); }
    }
  }));
  while (remaining.size) {
    const batch = await withMineruQueryRetry(() => withMineruRateLimit(() => client.queryUploadTaskBatch(batchId!), seconds => [...remaining.values()].forEach(i => progress(i.documentId, { label: `Server 限流，等待 ${seconds} 秒；保留原批量任务` }))), seconds => [...remaining.values()].forEach(i => progress(i.documentId, { label: `批量状态查询暂时断开，${seconds} 秒后重试；保留原批次` })));
    const files = new Map<string, any>();
    for (const f of batch.files ?? []) { if (files.has(f.dataId)) throw new Error('批量状态返回重复 dataId'); files.set(f.dataId, f); }
    for (const [id, item] of remaining) {
      const state = files.get(id); if (!state) throw new Error('批量状态缺少所选 PDF 的 dataId');
      progress(id, { ...mineruUpstreamStatus(state), upstreamCheckedAt: new Date().toISOString() });
      if (state.state === 'failed') { remaining.delete(id); parentPort!.postMessage({ documentId: id, error: safe(new Error(state.errMsg || 'MinerU 解析失败')) }); }
      else if (state.state === 'done') {
        remaining.delete(id);
        try {
          if (!state.zipUrl) throw new Error('MinerU 已完成，但缺少产物下载地址');
          progress(id, { phase: 'downloading', label: '下载转换产物（批量任务）' });
          await client.writeZipResult({ targetPath: item.outputPath, zipUrl: state.zipUrl });
          parentPort!.postMessage({ documentId: id, result: true });
        } catch (error) { parentPort!.postMessage({ documentId: id, error: safe(error) }); }
      }
    }
    if (remaining.size) await new Promise(r => setTimeout(r, 5000));
  }
  parentPort!.postMessage({ done: true });
} catch (error) { parentPort!.postMessage({ error: safe(error) }); }
