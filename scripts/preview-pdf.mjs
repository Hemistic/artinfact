import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const data = resolve(process.env.CODEX_PDF_PREVIEW_DIR ?? '.preview-data/pdf');
await mkdir(data, { recursive: true });
const client = new Client({ name: 'pdf-reader-preview', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server/index.js')], maxBufferSize: 64 * 1024 * 1024, env: { ...process.env, CODEX_PDF_DATA_DIR: data, CODEX_WORKSPACE_SETTINGS_DIR: resolve(data, 'workspace-settings') } });
await client.connect(transport);
const readerBase = (await client.callTool({ name: 'pdf_open', arguments: {} }))._meta.pdfReader.baseUrl;
const readerOrigin = new URL(readerBase).origin;
const previewPort = Number(process.env.CODEX_PDF_PREVIEW_PORT ?? 4180);
const previewOrigin = `http://127.0.0.1:${previewPort}`;
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && new URL(request.url, 'http://127.0.0.1:4180').pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(await readFile('dist/ui/pdf.html')); return;
    }
    if (request.method === 'GET' && request.url.startsWith(new URL(readerBase).pathname)) {
      const upstream = await fetch(new URL(request.url, readerOrigin));
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    if (request.method !== 'POST' || !['/preview/pdf-tool', '/preview/context', '/preview/message', '/preview/page-open'].includes(request.url)) { response.writeHead(404); response.end(); return; }
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > 32 * 1024 * 1024) throw new Error('Payload too large'); chunks.push(chunk); }
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    let result;
    if (request.url === '/preview/context') { await writeFile(resolve(data, 'last-context.json'), JSON.stringify(payload, null, 2)); result = {}; }
    else if (request.url === '/preview/message') { await writeFile(resolve(data, 'last-message.json'), JSON.stringify(payload, null, 2)); result = {}; }
    else if (request.url === '/preview/page-open') { if (!/^codex:\/\/space\/page_[a-f0-9]{32}$/.test(payload.url)) throw new Error('Invalid Pages deep link'); await writeFile(resolve(data, 'last-page-open.json'), JSON.stringify(payload, null, 2)); result = {}; }
    else {
      if (!payload.name.startsWith('whiteboard_') && !payload.name.startsWith('pdf_processor_') && !payload.name.startsWith('pdf_pages_') && !payload.name.startsWith('pdf_workspace_') && !payload.name.startsWith('pdf_ai_') && !payload.name.startsWith('pdf_source_') && !payload.name.startsWith('pdf_reference_') && !payload.name.startsWith('wiki_') && !['pdf_open', 'pdf_open_path', 'pdf_state_read', 'pdf_state_update', 'pdf_document_read', 'pdf_runtime_read', 'pdf_export_start', 'pdf_export_upload', 'pdf_export_finish', 'pdf_export_read', 'pdf_export_release', 'pdf_translation_preferences_read', 'pdf_translation_preferences_update', 'pdf_selection_translate', 'pdf_preferences_read', 'pdf_preferences_update', 'pdf_ui_language_read', 'pdf_ui_language_update', 'pdf_mineru_settings_read', 'pdf_mineru_settings_update', 'pdf_mineru_start', 'pdf_mineru_upload', 'pdf_mineru_run', 'pdf_mineru_status', 'pdf_mineru_read', 'pdf_mineru_tree', 'pdf_mineru_node', 'pdf_mineru_layout', 'pdf_selection_references', 'layout_workspace_read', 'layout_workspace_update'].includes(payload.name)) throw new Error('Unknown preview tool');
      if (payload.name === 'pdf_document_read') payload.arguments.url = payload.arguments.url.replace(previewOrigin, readerOrigin);
      result = await client.callTool(payload, undefined, { timeout: 120000 });
      if (result._meta?.pdfReader) {
        result._meta.pdfReader.baseUrl = result._meta.pdfReader.baseUrl.replace(readerOrigin, previewOrigin);
        if (result._meta.pdfReader.document) result._meta.pdfReader.document.url = result._meta.pdfReader.document.url.replace(readerOrigin, previewOrigin);
      }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] })); }
});
server.listen(previewPort, '127.0.0.1', () => process.stdout.write(`PDF reader preview: ${previewOrigin}/?preview=1\n`));
async function close() { server.close(); server.closeAllConnections(); await client.close(); }
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
process.on('message', message => { if (message === 'stop') void close().finally(() => { process.disconnect?.(); }); });

// Language preferences use the same isolated preview MCP store as the other settings.
