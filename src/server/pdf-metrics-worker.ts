import { parentPort, workerData } from './pdf-process-entry.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializePdfCanvas } from './pdf-native-canvas.js';
const require = createRequire(import.meta.url);
try {
  initializePdfCanvas();
  (globalThis as any).pdfjsWorker = await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.worker.mjs', import.meta.url).href);
  const api = await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.mjs', import.meta.url).href);
  const doc = await api.getDocument({ data: new Uint8Array(workerData.bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  try {
    if (doc.numPages > 10000) throw new Error('PDF 页数超过上限');
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) { const page = await doc.getPage(n); const box = page.view; pages.push({ width: box[2] - box[0], height: box[3] - box[1] }); }
    let count = 0;
    const convert = async (items: any[], depth = 0): Promise<object[]> => {
      if (depth > 24) return []; const nodes: object[] = [];
      for (const item of items) {
        if (++count > 2000) break; let pageIndex: number | undefined;
        try { const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest; if (dest?.[0] !== undefined) pageIndex = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]); } catch { /* Preserve readable outline entries with broken destinations. */ }
        nodes.push({ title: String(item.title ?? '').slice(0, 1000), location: { position: { pageIndex } }, items: await convert(item.items ?? [], depth + 1) });
      }
      return nodes;
    };
    parentPort!.postMessage({ pages, outline: await convert(await doc.getOutline() ?? []) });
  } finally { await doc.destroy(); }
} catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
