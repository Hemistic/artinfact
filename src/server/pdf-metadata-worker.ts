import { parentPort, workerData } from './pdf-process-entry.js';
import { initializePdfCanvas } from './pdf-native-canvas.js';
import {titlePageMetadata} from './pdf-title-page.js';
import {validBookTitle,validBookAuthor} from '../shared/book-metadata.js';
try {
  initializePdfCanvas();
  (globalThis as any).pdfjsWorker = await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.worker.mjs', import.meta.url).href);
  const api = await import(new URL('../../vendor/zotero-reader/runtime/pdf/build/pdf.mjs', import.meta.url).href);
  const doc = await api.getDocument({ data: new Uint8Array(workerData.bytes), isEvalSupported: false, disableFontFace: true }).promise;
  try {
    const {info,metadata} = await doc.getMetadata();
    const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    let title=text(info.Title || metadata?.get('dc:title')),author=text(info.Author || metadata?.get('dc:creator'));
    if(!validBookTitle(title)||!validBookAuthor(author))try{const page=await doc.getPage(1),content=await page.getTextContent(),first=titlePageMetadata(content.items.filter((item:any)=>typeof item.str==='string'),page.view[3]-page.view[1]);if(!validBookTitle(title))title=first.title;if(!validBookAuthor(author))author=first.author;}catch{/* Image-only PDFs retain their existing metadata. */}
    parentPort!.postMessage({ title, author });
  } finally { await doc.destroy(); }
} catch { parentPort!.postMessage({ title: '', author: '' }); }
