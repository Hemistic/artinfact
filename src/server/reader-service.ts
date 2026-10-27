import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream' };
export type OpenPdf = { id: string; name: string; url: string; size: number };
export type ReaderService = Awaited<ReturnType<typeof startReaderService>>;

// Zotero embeds its PDF.js viewer in a same-origin iframe. Serve its packaged assets locally.
export async function startReaderService(assetRoot: string) {
  const root = await realpath(assetRoot);
  const token = randomBytes(32).toString('hex');
  const documents = new Map<string, Buffer>();
  let runtime: string | undefined;let compressedRuntime:Promise<{text:string;revision:string}>|undefined;
  let origin = '';
  const server = createServer(async (request, response) => {
    const fail = (status: number) => { response.writeHead(status); response.end(); };
    try {
      if (request.headers.host !== new URL(origin).host) { fail(403); return; }
      const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
      if (!pathname.startsWith(`/${token}/`)) { fail(404); return; }
      const name = pathname.slice(token.length + 2);
      if (!name || name.includes('\\') || name.split('/').some(part => part === '..' || part.startsWith('.'))) { fail(404); return; }
      if (request.method === 'OPTIONS') {
        if (!['GET', 'HEAD'].includes(String(request.headers['access-control-request-method']))) { fail(405); return; }
        response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD', ...(request.headers['access-control-request-private-network'] === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}), 'Cache-Control': 'no-store' });
        response.end(); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { fail(405); return; }
      let bytes: Buffer, extension: string;
      if (name.startsWith('documents/')) {
        const value = documents.get(name.slice(10));
        if (!value) { fail(404); return; }
        bytes = value; extension = '.pdf';
      } else {
        const path = await realpath(join(root, name));
        const contained = relative(root, path);
        if (contained.startsWith('..') || isAbsolute(contained) || !(await stat(path)).isFile()) { fail(404); return; }
        bytes = await readFile(path); extension = extname(path);
      }
      response.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'" });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { if (!response.headersSent) fail(404); else response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地阅读器');
  origin = `http://127.0.0.1:${address.port}`;
  server.unref();
  const baseUrl = `${origin}/${token}/`;
  return {
    origin, baseUrl,
    readDocument(url: string, offset: number, length: number) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 768 * 1024) throw new Error('无效的 PDF 读取范围');
      if (!url.startsWith(`${baseUrl}documents/`)) throw new Error('无效的 PDF 读取地址');
      const bytes = documents.get(url.slice((`${baseUrl}documents/`).length));
      if (!bytes) throw new Error('PDF 已过期，请重新打开');
      if (offset > bytes.length) throw new Error('无效的 PDF 读取范围');
      return { offset, total: bytes.length, data: bytes.subarray(offset, offset + length).toString('base64') };
    },
    async readRuntime(offset: number, length: number, encoding:'utf8'|'gzip-base64'='utf8') {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 384 * 1024) throw new Error('无效的阅读器读取范围');
      runtime ??= await readFile(join(root, 'reader-local.html'), 'utf8');
      if(encoding==='gzip-base64'){
        compressedRuntime??=promisify(gzip)(runtime).then(bytes=>({text:bytes.toString('base64'),revision:createHash('sha256').update(bytes).digest('hex')})).catch(error=>{compressedRuntime=undefined;throw error;});
        const value=await compressedRuntime;if(offset>value.text.length)throw Error('无效的阅读器读取范围');return {text:value.text.slice(offset,offset+length),offset,total:value.text.length,encoding,revision:value.revision};
      }
      if (offset > runtime.length) throw new Error('无效的阅读器读取范围');
      return { text: runtime.slice(offset, offset + length), offset, total: runtime.length };
    },
    async open(path: string): Promise<OpenPdf> {
      if (!isAbsolute(path) || extname(path).toLowerCase() !== '.pdf') throw new Error('请选择 PDF 文件的绝对路径');
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_PDF_BYTES) throw new Error('PDF 必须是文件，且不超过 64 MB');
      const bytes = await readFile(path);
      if (bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF');
      const id = createHash('sha256').update(bytes).digest('hex');
      const handle = randomBytes(24).toString('hex');
      if (documents.size >= 4) documents.delete(documents.keys().next().value!);
      documents.set(handle, bytes);
      return { id, name: basename(path), size: bytes.length, url: `${baseUrl}documents/${handle}` };
    },
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); documents.clear(); }),
  };
}
