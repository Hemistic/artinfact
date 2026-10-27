import { PDF_FEATURES } from '../src/shared/pdf-features.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { simplePdf } from './fixtures/simple-pdf.ts';

test('production AI runs validate MinerU evidence, preserve both analyses and build PDF-linked graphs', async () => {
  assert.equal(PDF_FEATURES.aiAnalysis,true);
  const root = await mkdtemp(join(tmpdir(), 'codex-research-mcp-')); const data = join(root, 'profile'); const workspace = join(root, 'workspace'); await mkdir(workspace);
  const client = new Client({ name: 'research-test', version: '1' });
  let stderr = '', processExit = '';
  const call = async (name: string, args: any = {}) => { try { return await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 }) as any; } catch (error) { throw new Error(`${name}: ${String(error)}; ${processExit}; ${stderr.slice(-1600)}`); } };
  const research = (r: any) => r.structuredContent?.research ?? r._meta?.research;
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(process.env.CODEX_RESEARCH_TEST_SERVER ?? 'dist/server/index.js')], stderr: 'pipe', env: { ...process.env, CODEX_LAYOUT_WORKSPACE: workspace, CODEX_PDF_DATA_DIR: data, CODEX_WORKSPACE_SETTINGS_DIR: join(data, 'settings') } });
  transport.stderr?.on('data', c => { stderr += String(c); });
  await client.connect(transport);
  (transport as any)._process?.on('exit', (code: number, signal: string) => { processExit = `exit=${code}, signal=${signal}`; });
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.find(t => t.name === 'pdf_ai_write')?.annotations?.readOnlyHint, false);
    assert.deepEqual((tools.find(t => t.name === 'pdf_ai_task_begin')?._meta?.ui as any).visibility, ['app']);
    await call('pdf_workspace_list'); const file = join(root, 'sample.pdf'); await writeFile(file, simplePdf());
    const imported = await call('pdf_workspace_import_path', { workspaceId: 'default', path: file }); const doc = imported._meta.document; const args = { workspaceId: 'default', documentId: doc.id };
    assert.equal((await call('pdf_ai_task_begin',{...args,scope:'outline'})).isError,true);
    const output = join(doc.projectDir, 'mineru', 'runs', 'fixture', 'output'); await mkdir(output, { recursive: true });
    const blocks = [{ type: 'text', text: '1 Introduction', text_level: 1, page_idx: 0, bbox: [100, 50, 900, 90] }, { type: 'text', text: 'Hello packaged PDF reader', page_idx: 0, bbox: [100, 90, 900, 130] }, { type: 'text', text: '2 Conclusion', text_level: 1, page_idx: 0, bbox: [100, 600, 900, 650] }, { type: 'text', text: 'Our source-grounded evidence remains bound to the original document.', page_idx: 0, bbox: [100, 660, 900, 730] }];
    await writeFile(join(output, 'document-mineru.json'), JSON.stringify(blocks)); await writeFile(join(output, 'document-mineru.md'), '# Introduction\nHello packaged PDF reader\n# Conclusion\nOur source-grounded evidence remains bound to the original document.');
    await writeFile(join(doc.projectDir, 'mineru', 'result.json'), JSON.stringify({ directory: output, name: doc.name, pages: [{ width: 612, height: 792 }] }));
    await call('pdf_state_update', { ...args, patch: { annotations: [{ id: 'manual', type: 'note', comment: 'Keep manual' }], viewState: { pageIndex: 0 } } });
    let expectedOutlineItems = 1;
    if (PDF_FEATURES.aiAnalysis) {
    await call('pdf_ui_language_update',{language:'en'});
    const templates=await call('whiteboard_templates',{workspaceId:'default'});assert.equal(templates.structuredContent.languagePolicy.outputLanguage,'en');
    const inspected = await call('pdf_ai_inspect', args);assert.equal(inspected.structuredContent.languagePolicy.outputLanguage,'en'); assert.equal(inspected.isError, undefined, JSON.stringify(inspected.content)); const source = research(inspected).aiOutlineSource; assert.equal(source.outlineSource, 'mineru-json'); assert.ok(source.entries.length);
    const briefResult = await call('pdf_ai_brief', args); assert.equal(briefResult.isError, undefined, JSON.stringify(briefResult.content)); const brief = research(briefResult).brief; assert.ok(brief.blocks.length);
    const text = brief.blocks.find((b: any) => b.text?.includes('Hello packaged'));
    assert.ok(text, JSON.stringify(brief).slice(0, 1000));
    const job = research(await call('pdf_ai_task_begin', { ...args, scope: 'outline' }));
    assert.equal(job.delivery, 'prepared');
    const delivery = research(await call('pdf_ai_task_delivery', { ...args, jobId: job.id, mode: 'manual' }));
    assert.equal(delivery.delivery, 'manual');
    const reused = research(await call('pdf_ai_task_begin', { ...args, scope: 'outline' })); assert.equal(reused.id, job.id);
    assert.equal((await call('pdf_ai_task_delivery', { ...args, workspaceId: 'ws-aaaaaaaaaaaaaaaa', jobId: job.id, mode: 'sent' })).isError, true);
    await call('pdf_ai_task_delivery', { ...args, jobId: job.id, mode: 'sent' });
    assert.equal((await call('pdf_ai_task_begin', { ...args, scope: 'outline' })).isError, true);
    const badScope = await call('pdf_ai_write', { ...args, jobId: job.id, input: { aiInsights: [{ aiInsightKind: 'evidence', aiInsightKey: 'wrong', text: 'Evidence', comment: 'Source evidence', quote: 'Hello packaged PDF reader', aiInsightSourceBlockId: text.id }] } }); assert.equal(badScope.isError, true);
    const writtenOutline = await call('pdf_ai_write', { ...args, jobId: job.id, input: { aiOutline: { language: 'en', items: source.entries.map((e: any) => ({ id: e.id, annotation: 'Explains the research problem and the supporting source evidence.' })) } } }); assert.equal(writtenOutline.isError, undefined, JSON.stringify(writtenOutline.content)); assert.equal(research(writtenOutline).valid, true);assert.equal(research(writtenOutline).aiOutline.language,'en');assert.equal(job.outputLanguage,'en');
    // UI saving and Agent analysis share a stdio server and must not close each other’s transport.
    const parallel=await Promise.all([call('pdf_ai_inspect',args),call('pdf_ai_brief',args),call('pdf_state_update',{...args,patch:{annotations:[{id:'manual',comment:'Keep manual'}]}})]);
    for(const result of parallel)assert.equal(result.isError,undefined,JSON.stringify(result.content));
    await client.ping();
    const insightInput = { aiInsights: [{ aiInsightKind: 'evidence', aiInsightKey: 'original-text', text: 'Source evidence', comment: 'This sentence preserves the evidence from the original document.', quote: 'Hello packaged PDF reader', aiInsightSourceBlockId: text.id }] };
    const insightJob=research(await call('pdf_ai_task_begin',{...args,scope:'insights'}));
    const originalMarkdown=await readFile(join(output,'document-mineru.md'),'utf8');
    await writeFile(join(output,'document-mineru.md'),originalMarkdown+'\nChanged by another parser.');
    assert.equal((await call('pdf_ai_write',{...args,jobId:insightJob.id,input:insightInput})).isError,true);
    await writeFile(join(output,'document-mineru.md'),originalMarkdown);
    const invalid = await call('pdf_ai_write', { ...args, input: { aiInsights: [{ ...insightInput.aiInsights[0], quote: 'This invented evidence never occurred in this PDF.', position: { pageIndex: 0, rects: [[1, 1, 2, 2]] } }] } }); assert.equal(research(invalid).valid, false); assert.equal(research(await call('pdf_ai_read', args)).aiInsights.length, 0);
    const insight = await call('pdf_ai_write', { ...args, jobId:insightJob.id, input: insightInput }); assert.equal(insight.isError, undefined, JSON.stringify(insight.content)); assert.equal(research(insight).valid, true, JSON.stringify(research(insight))); assert.ok(research(insight).aiInsights[0].position.rects.length); assert.equal(research(insight).aiOutline.items.length, source.entries.length);
    assert.equal(research(insight).jobs.insights.status,'completed');assert.equal(research(insight).aiInsightMeta.language,'en');assert.equal(research(insight).aiInsights[0].quote,'Hello packaged PDF reader');
    const outlineAgain=research(await call('pdf_ai_task_begin',{...args,scope:'outline'}));
    const regenerated=research(await call('pdf_ai_write',{...args,jobId:outlineAgain.id,input:{aiOutline:{language:'zh',items:source.entries.map((e:any)=>({id:e.id,annotation:'更新章节说明，保留已保存洞察'}))}}}));
    assert.equal(regenerated.valid,true);assert.equal(regenerated.aiInsights.length,1);assert.equal(regenerated.jobs.outline.status,'completed');
    assert.ok(research(insight).diagnostics.some((d: any) => d.positionSource === 'pdf-text'), JSON.stringify(research(insight).diagnostics));
    const state = (await call('pdf_state_read', args))._meta.pdfState; assert.ok(state.annotations.some((a: any) => a.id === 'manual')); assert.equal(state.annotations.length, 2);
    const persisted = JSON.parse(await readFile(join(doc.projectDir, 'state.json'), 'utf8')); assert.equal(persisted.aiOutline.items.length, source.entries.length);
    expectedOutlineItems = source.entries.length;
    } else {
      const saved = JSON.parse(await readFile(join(doc.projectDir, 'state.json'), 'utf8'));
      saved.aiOutline = { items: [{ id: 'retained', annotation: 'Existing outline' }] };
      await writeFile(join(doc.projectDir, 'state.json'), JSON.stringify(saved));
      for (const [name, extra] of [['pdf_ai_inspect', {}], ['pdf_ai_brief', {}], ['pdf_ai_prepare', { input: {} }], ['pdf_ai_write', { input: {} }], ['pdf_ai_task_begin', { scope: 'outline' }]] as const) {
        const result = await call(name, { ...args, ...extra }); assert.equal(result.isError, true, name); assert.match(result.content[0].text, /暂未开放/);
      }
      for (const kind of ['markdown', 'json', 'bundle']) { const result = await call('pdf_mineru_read', { ...args, kind }); assert.equal(result.isError, true); assert.match(result.content[0].text, /不支持直接导出/); }
      const retained = research(await call('pdf_ai_read', args)); assert.equal(retained.aiOutline.items[0].id, 'retained');
      const state = (await call('pdf_state_read', args))._meta.pdfState; assert.equal(state.annotations.length, 1); assert.equal(state.annotations[0].id, 'manual');
    }
    assert.equal((await call('wiki_import_sources', { workspaceId: 'default', documentIds: [doc.id] })).isError, undefined);
    assert.equal((await call('wiki_write', { workspaceId: 'default', path: `wiki/sources/${doc.id}.md`, expectedRevision: null, text: `---\ntitle: Sample\ntype: source\nsources:\n  - .raw/imports/${doc.id}/source.md\n---\n# Sample\nHello packaged PDF reader (PDF page 1)` })).isError, undefined);
    const graph = research(await call('wiki_graph_build', { workspaceId: 'default' })); assert.equal(graph.summary.documentCount, 1); assert.equal(graph.summary.rawSourceCount, 0);
    const premature=await call('wiki_graph_build',{workspaceId:'default',documentIds:[doc.id]});assert.equal(premature.isError,true);assert.match(premature.content[0].text,/PREPROCESS_REQUIRED/);
    const cacheValue=(r:any)=>{assert.equal(r.isError,undefined,JSON.stringify(r.content));return r.structuredContent;};
    const prepArgs={workspaceId:'default'},before=cacheValue(await call('whiteboard_pdf_preprocess_read',prepArgs));
    let prep=cacheValue(await call('whiteboard_pdf_preprocess_request',{...prepArgs,documentIds:[doc.id],expectedRevision:before.revision,requestId:'preprocess-test'}));
    const catalog=cacheValue(await call('whiteboard_sources',prepArgs)),drafts=[];
    for(const source of catalog.sources.filter((s:any)=>s.documentId===doc.id)){const raw=cacheValue(await call('whiteboard_source_read',{...prepArgs,sourceId:source.id}));drafts.push({sourceId:source.id,title:source.name.slice(0,240),note:'Fixture Agent analysis: '+source.category,citations:[{sourceId:source.id,start:0,end:raw.text.length,quote:raw.text}],...(source.category==='formula'?{presentation:{type:'formula',latex:source.latex??raw.text,explanation:'Fixture explanation',symbols:[]}}:{})});}
    prep=cacheValue(await call('whiteboard_pdf_preprocess_apply',{...prepArgs,taskId:prep.task.id,expectedRevision:prep.revision,requestId:'preprocess-results',drafts,summary:'Fixture Agent results saved'}));assert.equal(prep.task.status,'completed');
    const unified=research(await call('wiki_graph_build',{...prepArgs,documentIds:[doc.id]}));assert.ok(unified.cards.pdfCards>=drafts.length);assert.equal(unified.summary.documentCount,1);
    const manifest = JSON.parse(await readFile(join(doc.projectDir, '../claude-obsidian-graph-vault/.raw/imports', doc.id, 'manifest.json'), 'utf8'));
    assert.equal(manifest.kind, 'mineru-markdown'); assert.equal(manifest.originalPdf, doc.sourcePath); assert.match(manifest.markdownSha256, /^[a-f0-9]{64}$/);
    const savedGraph = JSON.parse(await readFile(join(doc.projectDir, '../claude-obsidian-graph-vault/wiki-graph.json'), 'utf8'));
    const sourceNode = savedGraph.nodes.find((n: any) => n.id === `wiki/sources/${doc.id}.md`);
    assert.equal(sourceNode.document.markdownPath, manifest.markdownPath); assert.equal(sourceNode.document.originalPdf, doc.sourcePath);
    assert.equal(savedGraph.nodes.filter((n: any) => n.type === 'raw' && /source\.(pdf|md)$/.test(n.relativePath)).length, 0);
    await call('pdf_ai_clear', { ...args, scope: 'insights' }); const cleared = research(await call('pdf_ai_read', args)); assert.equal(cleared.aiInsights.length, 0); assert.equal(cleared.aiOutline.items.length, expectedOutlineItems);
    assert.equal((await call('pdf_ai_read', { ...args, workspaceId: 'ws-aaaaaaaaaaaaaaaa' })).isError, true);
  } finally { await client.close(); }
});
