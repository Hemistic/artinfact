import { parentPort, workerData } from './pdf-process-entry.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { partitionLightPdf } from './mineru-light-split.js';
import { initializePdfCanvas } from './pdf-native-canvas.js';

try {
  initializePdfCanvas();
  const require = createRequire(import.meta.url);
  const toolkit = require(fileURLToPath(new URL('../../vendor/pdf-worker/runtime/worker.cjs', import.meta.url))) as { deletePages(bytes: ArrayBuffer, indexes: number[], password: string): Promise<ArrayBuffer> };
  const bytes = Buffer.from(workerData.bytes);
  const parts = await partitionLightPdf(bytes, workerData.pages, async (first, last) => {
    const remove = Array.from({ length: workerData.pages }, (_, i) => i).filter(i => i < first - 1 || i >= last);
    return Buffer.from(await toolkit.deletePages(Uint8Array.from(bytes).buffer, remove, ''));
  });
  parentPort!.postMessage({ parts });
} catch (e) { parentPort!.postMessage({ error: `PDF 拆分失败：${e instanceof Error ? e.message : String(e)}` }); }
