import { parentPort, workerData } from './pdf-process-entry.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.PDF_AI_CONTEXT_READER_DIR = fileURLToPath(new URL('../../vendor/zotero-reader/runtime/', import.meta.url));
process.env.CODEX_RESEARCH_PDF_WORKER = fileURLToPath(new URL('../../vendor/research/runtime/pdf.cjs', import.meta.url));
try {
  const canvas = require(fileURLToPath(new URL('../../vendor/mineru/runtime/node_modules/@napi-rs/canvas/index.js', import.meta.url)));
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
  const runtime = require(fileURLToPath(new URL('../../vendor/research/runtime/context.cjs', import.meta.url)));
  const language=workerData.language==='en'?'en':'zh';
  const input=workerData.input?{...workerData.input,...(workerData.input.aiOutline?{aiOutline:{...workerData.input.aiOutline,language}}:{}),...(workerData.input.aiInsightMeta?{aiInsightMeta:{...workerData.input.aiInsightMeta,language}}:{})}:undefined;
  const payload = { workspace: workerData.root, projectID: workerData.documentId, language, input, scope: workerData.scope };
  let value;
  if(workerData.operation==='context')value={inspection:await runtime.inspectAiContext(payload),brief:await runtime.briefAiContext(payload)};
  else if (workerData.operation === 'inspect') value = await runtime.inspectAiContext(payload);
  else if (workerData.operation === 'brief') value = await runtime.briefAiContext(payload);
  else if (workerData.operation === 'prepare' || workerData.operation === 'write') {
    const prepared = await runtime.prepareAiInsights(payload);
    if (workerData.operation === 'prepare' || !prepared.valid) value = prepared;
    else value = { valid: true, diagnostics: prepared.diagnostics, result: await runtime.writeAiContext({ ...payload, input: { ...(prepared.aiOutline ? { aiOutline: prepared.aiOutline } : {}), ...(prepared.aiInsights ? { aiInsights: prepared.aiInsights, aiInsightMeta: { ...workerData.input.aiInsightMeta, language, status: 'ready', provider: 'codex-pdfai-context', innovationCount: prepared.aiInsights.filter((a: any) => a.aiInsightKind === 'innovation').length, evidenceCount: prepared.aiInsights.filter((a: any) => a.aiInsightKind === 'evidence').length } } : {}) } }) };
  } else if (workerData.operation === 'clear') value = await runtime.clearAiContext(payload);
  else throw new Error('未知研究操作');
  parentPort!.postMessage({ value });
} catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
