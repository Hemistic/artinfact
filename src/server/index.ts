import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLayoutServer } from './server.js';
import { startReaderService } from './reader-service.js';
import { PdfStateStore } from './pdf-store.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSettings } from './workspace-settings.js';
import { WorkspaceLibrary } from './workspaces.js';
import { WorkspaceRuntime } from './workspace-runtime.js';
import {createMcpDiagnostics} from './mcp-diagnostics.js';
import {PLUGIN_VERSION} from '../shared/version.js';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const pdfHtml = await readFile(new URL('../ui/pdf.html', import.meta.url), 'utf8');
const workspaceSettings = new WorkspaceSettings(process.env.CODEX_WORKSPACE_SETTINGS_DIR ?? join(homedir(), '.codex', 'plugin-data', 'codex-work-layout'), process.env.CODEX_LAYOUT_WORKSPACE);
const diagnostics=createMcpDiagnostics(process.env.CODEX_WORKSPACE_SETTINGS_DIR??join(homedir(),'.codex','plugin-data','codex-work-layout'),PLUGIN_VERSION);
diagnostics.record('starting');
process.on('uncaughtExceptionMonitor',(error,origin)=>diagnostics.record('uncaught-'+origin,error));
process.once('exit',code=>diagnostics.record('process-exit',`code=${code}`));
const { workspace } = await workspaceSettings.initialize();
process.chdir(workspace);
const readerService = await startReaderService(fileURLToPath(new URL('../../vendor/zotero-reader/runtime', import.meta.url)));
const store = new PdfStateStore(process.env.CODEX_PDF_DATA_DIR ?? join(homedir(), '.codex', 'plugin-data', 'codex-work-layout', 'pdf-reader'));
const workspaceRuntime = new WorkspaceRuntime(new WorkspaceLibrary(() => workspaceSettings.read().workspace), store);
const server = createLayoutServer({
  workspace,
  workspaceSettings,
  pluginRoot: fileURLToPath(new URL('../../', import.meta.url)),
  html,
  pdf: { workspaceRuntime, workspaceSettings, workspace, service: readerService, store, html: pdfHtml },
});
const previousClose = server.server.onclose;
server.server.onerror=error=>diagnostics.record('transport-error',error);
server.server.onclose = () => { diagnostics.record('transport-closed');previousClose?.(); void readerService.close(); };
process.stdin.once('end', () => { diagnostics.record('stdin-ended'); void server.close(); void readerService.close(); });
// PDF annotations can contain image crops; the store already bounds their size.
await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 * 1024 }));
diagnostics.record('connected');
