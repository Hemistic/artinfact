import { isolatedPdfTask } from './pdf-process.js';
export async function pdfMetadata(bytes: Buffer): Promise<{ title: string; author: string }> {
  const buffer = Uint8Array.from(bytes).buffer;
  try { const value = await isolatedPdfTask(new URL('./pdf-metadata-worker.js', import.meta.url), { bytes: buffer }, 20000); return { title: typeof value.title === 'string' ? value.title.slice(0, 500) : '', author: typeof value.author === 'string' ? value.author.slice(0, 500) : '' }; }
  catch { return { title: '', author: '' }; }
}
