import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { withMineruRateLimit } from './mineru-rate-limit.js';
import { mineruUpstreamStatus } from '../shared/mineru-upstream-status.js';
import { uploadMineruPdf } from './mineru-upload.js';
const require = createRequire(import.meta.url);
type Client = { createUploadTask(args: object): Promise<{ batchId: string; uploadUrl: string }>; uploadPdfToMineru(url: string, data: Buffer): Promise<void>; waitForTask(id: string): Promise<object>; writeZipResult(args: object): Promise<object>; convertPdfToMarkdown(args: object): Promise<object>; queryUploadTask(id: string): Promise<object> };
const { MineruMarkdownService } = require(fileURLToPath(new URL('../../vendor/mineru/runtime/client.cjs', import.meta.url))) as { MineruMarkdownService: new (options: object) => Client };
const progress = (value: object) => parentPort!.postMessage({ progress: value });
try {
  const client = new MineruMarkdownService({ baseURL: workerData.baseUrl, clientKey: workerData.clientKey, pollIntervalMs: 5000, timeoutMs: 15 * 60 * 1000, logger: { log(...values: unknown[]) {
    const event = String(values[1] ?? ''); const detail = values[2] as Record<string, unknown> | undefined;
    if (event.includes('download:')) progress({ phase: 'downloading', label: '下载转换产物' });
    if (event === 'task:poll') progress(mineruUpstreamStatus(detail ?? {}));
  } } });
  const create = client.createUploadTask.bind(client);
  client.createUploadTask = async args => {
    progress({ phase: 'creating', label: '创建 MinerU 任务' });
    const task = await withMineruRateLimit(() => create({ ...args, fileName: workerData.name }), seconds => progress({ phase: 'creating', label: `Server 限流，等待 ${seconds} 秒` })); progress({ phase: 'uploading', label: '上传 PDF', batchId: task.batchId, uploadUrl: task.uploadUrl }); return task;
  };
  client.uploadPdfToMineru = async (url, data) => { const receipt = await uploadMineruPdf(url, data); progress({ ...receipt, phase: 'parsing', label: 'PDF 已上传，正在查询 MinerU 云端状态', upstreamState: undefined, progress: undefined }); };
  const query = client.queryUploadTask.bind(client);
  client.queryUploadTask = async id => { const value = await withMineruRateLimit(() => query(id), seconds => progress({ phase: 'parsing', label: `Server 限流，等待 ${seconds} 秒；保留原任务` })) as Record<string, unknown>; progress({ ...mineruUpstreamStatus(value), upstreamCheckedAt: new Date().toISOString() }); return value; };
  let result: object;
  if (workerData.resumeBatchId) {
    if (workerData.resumeUploadUrl) { const { readFile } = await import('node:fs/promises'); await client.uploadPdfToMineru(workerData.resumeUploadUrl, await readFile(workerData.filePath)); }
    const status = await client.waitForTask(workerData.resumeBatchId) as { zipUrl: string };
    progress({ phase: 'downloading', label: '下载转换产物' }); result = await client.writeZipResult({ targetPath: workerData.outputPath, zipUrl: status.zipUrl });
  } else result = await client.convertPdfToMarkdown({ filePath: workerData.filePath, outputPath: workerData.outputPath, dataId: workerData.documentId, ...workerData.options });
  parentPort!.postMessage({ result });
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  parentPort!.postMessage({ error: text.replaceAll(String(workerData.clientKey), '[redacted]').slice(0, 500) });
}
