import { parentPort, workerData } from './pdf-process-entry.js';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializePdfCanvas } from './pdf-native-canvas.js';

const require = createRequire(import.meta.url);
type Toolkit = { writeAnnotations(bytes: ArrayBuffer, annotations: unknown[], password: string, cmap: (name: string) => Promise<object>, font: (name: string) => Promise<Buffer>): Promise<ArrayBuffer> };
const root = new URL('../../vendor/pdf-worker/runtime/', import.meta.url);
const asset = async (folder: string, name: string) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('无效的 PDF 字体资源');
  return readFile(new URL(`${folder}/${name}`, root));
};
try {
  initializePdfCanvas();
  const toolkit = require(fileURLToPath(new URL('worker.cjs', root))) as Toolkit;
  const annotations = workerData.annotations.map((value: Record<string, unknown>) => ({ tags: [], authorName: '', comment: '', text: '', dateModified: new Date().toISOString(), ...value }));
  const bytes = await toolkit.writeAnnotations(workerData.bytes, annotations, '', async name => ({ compressionType: 1, cMapData: await asset('cmaps', `${name}.bcmap`) }), name => asset('standard_fonts', name));
  parentPort!.postMessage({ bytes }, [bytes]);
} catch (error) { parentPort!.postMessage({ error: `生成批注 PDF 失败：${error instanceof Error ? error.message : String(error)}` }); }
