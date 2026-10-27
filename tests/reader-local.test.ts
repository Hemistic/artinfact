import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { localPdfFactories } from '../src/ui/viewer-local.ts';

test('native Outline sidebar offers both enabled AI buttons and routes each click to its original callback', async () => {
  const html = await readFile('vendor/zotero-reader/runtime/reader-local.html', 'utf8');
  const start = html.indexOf('function OutlineAIActionButtons('), end = html.indexOf('function Sidebar(props)', start);
  const render = new Script(html.slice(start, end) + '\nOutlineAIActionButtons({ annotations: [], onGenerateAiOutline: () => calls.push("outline"), onGenerateAiInsights: () => calls.push("insights") })');
  const createElement = (type: unknown, props: any, ...children: any[]) => ({ type, props, children });
  const calls:string[]=[];
  const context = { calls, window: { __codexAIEnabled: false }, getAIActionText: () => ({ aiNotes: 'AI 大纲', aiInsights: 'AI 洞察',generateAiNotes:'生成 AI 注释',generateAiInsights:'生成 AI 洞察' }), isAIInsightAnnotation: () => false, react__WEBPACK_IMPORTED_MODULE_0___default: () => ({ createElement }), _res_icons_20_annotate_note_svg__WEBPACK_IMPORTED_MODULE_6__: { default: 'note' }, _res_icons_20_annotate_highlight_svg__WEBPACK_IMPORTED_MODULE_7__: { default: 'highlight' } };
  const paused = render.runInNewContext(context);
  assert.equal(paused.children.length, 2);
  for (const child of paused.children) { assert.equal(child.props.disabled, true); assert.match(child.props.title, /暂未开放/); assert.equal(typeof child.props.onClick, 'function'); }
  context.window.__codexAIEnabled = true;
  const active=render.runInNewContext(context);
  assert.equal(active.props.className,'outline-ai-actions');
  assert.deepEqual(Array.from(active.children,(child:any)=>child.children[1].children[0]),['AI 大纲','AI 洞察']);
  assert.deepEqual(Array.from(active.children,(child:any)=>child.props['aria-label']),['生成 AI 大纲','生成 AI 洞察']);
  for (const child of active.children) {assert.equal(child.props.disabled, false);child.props.onClick();}
  assert.deepEqual(calls,['outline','insights']);
});

test('packaged Zotero Reader and its nested PDF viewer have executable inline scripts and include actual CMaps, fonts and codecs', async () => {
  const html = await readFile('vendor/zotero-reader/runtime/reader-local.html', 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 3);
  for (const script of scripts) new Script(script);
  // A srcdoc location cannot be the base of a relative URL during Reader initialization.
  assert.equal(scripts[2].includes("new URL('./', window.location)"), false);
  const reader: { __CODEX_PDF_VIEWER__?: string } = {};
  new Script(scripts[0]).runInNewContext({ window: reader });
  const viewer = reader.__CODEX_PDF_VIEWER__!;
  assert.ok(viewer);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/);
  assert.doesNotMatch(viewer, /<script[^>]*\ssrc=|<link[^>]*stylesheet/);
  const module = viewer.match(/<script type="module">([\s\S]*?)<\/script>/)![1];
  assert.equal(spawnSync(process.execPath, ['--check', '--input-type=module'], { input: module, encoding: 'utf8' }).status, 0);
  const resources: { __CODEX_ASSETS__?: Record<string, string> } = {};
  new Script(viewer.match(/<script>([\s\S]*?)<\/script>/)![1]).runInNewContext({ window: resources });
  const factories = localPdfFactories(resources.__CODEX_ASSETS__!);
  assert.deepEqual((await new factories.CMapReaderFactory().fetch({ name: '78-EUC-H' })).cMapData, new Uint8Array(await readFile('vendor/zotero-reader/runtime/pdf/web/cmaps/78-EUC-H.bcmap')));
  assert.deepEqual(await new factories.StandardFontDataFactory().fetch({ filename: 'LiberationSans-Regular.ttf' }), new Uint8Array(await readFile('vendor/zotero-reader/runtime/pdf/web/standard_fonts/LiberationSans-Regular.ttf')));
  assert.deepEqual(await new factories.WasmFactory().fetch({ filename: 'openjpeg.wasm' }), new Uint8Array(await readFile('vendor/zotero-reader/runtime/pdf/web/wasm/openjpeg.wasm')));
  await assert.rejects(new factories.CMapReaderFactory().fetch({ name: '../outside' }), /缺失/);
});
