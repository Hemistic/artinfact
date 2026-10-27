import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMineruLayout } from '../src/ui/mineru-layout.ts';
import { readerAnalysisMenu } from '../src/shared/reader-menu.ts';

test('opening a reader only loads layout status; parsing starts only after explicit click', async () => {
  const calls:string[]=[];
  const control=installMineruLayout({current:()=>({document:{id:'a',workspaceId:'default',name:'a.pdf'},ready:true}),call:async(name)=>{calls.push(name);return {_meta:{layoutStatus:{phase:'idle',modelVersion:'MinerU 本机 4.0.10',completedPages:0,totalPages:0,figures:0,tables:0,equations:0}}};},progress:()=>{},apply:async()=>{},notice:()=>{}});
  control.changed(); await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls,['pdf_workspace_layout_status']);
  await control.restart(); assert.equal(calls.filter(n=>n==='pdf_workspace_layout_start').length,1);control.stop();
});

test('MinerU 本机 parsing disables duplicate layout submissions and retains the action after success', () => {
  const running=readerAnalysisMenu({documentId:'a',phase:'parsing',engine:'local'}, {phase:'running',completedPages:0,totalPages:10,figures:0,tables:0,equations:0,modelVersion:'MinerU 本机 4.0.10'});
  assert.equal(running.layoutDisabled,true);assert.match(running.layoutDetail,/本机/);
  const idle=readerAnalysisMenu({documentId:'a',phase:'idle',engine:'local'},{phase:'idle',completedPages:0,totalPages:0,figures:0,tables:0,equations:0,modelVersion:'MinerU 本机 4.0.10'});
  assert.match(idle.layoutTitle,/Markdown.*JSON/);
});

test('layout clicks share one pending submission for a document, while another document can start independently', async () => {
  let document = { id: 'a', workspaceId: 'ws', name: 'a.pdf' };
  const submissions: Array<{ documentId: unknown; resolve(value: unknown): void }> = [];
  const progress: unknown[] = [];
  const status = { phase: 'queued', modelVersion: 'MinerU 本机', completedPages: 0, totalPages: 1, figures: 0, tables: 0, equations: 0 };
  const control = installMineruLayout({ current: () => ({ document, ready: true }), progress: value => progress.push(value), apply: async () => {}, notice: () => {}, call: (name, args) => {
    assert.equal(name, 'pdf_workspace_layout_start');
    return new Promise(resolve => submissions.push({ documentId: args.documentId, resolve }));
  } });
  try {
    const first = control.ensure(), second = control.ensure();
    assert.equal(submissions.length, 1);
    document = { id: 'b', workspaceId: 'ws', name: 'b.pdf' };
    const third = control.ensure();
    assert.equal(submissions.length, 2);
    submissions[0].resolve({ _meta: { layoutStatus: { ...status, token: 'a' } } });
    await Promise.all([first, second]);
    assert.ok(progress.every(value => !value || (value as any).token !== 'a'));
    submissions[1].resolve({ _meta: { layoutStatus: { ...status, token: 'b' } } });
    await third;
    assert.equal((progress.at(-1) as any).token, 'b');
  } finally { control.stop(); }
});

test('stopping layout observation while annotations are applying does not restart its polling timer', async t => {
  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
  const timers = new Set<object>();
  globalThis.setTimeout = (() => { const token = { unref() {} }; timers.add(token); return token; }) as any;
  globalThis.clearTimeout = ((token: object) => timers.delete(token)) as any;
  t.after(() => { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; });
  let finishApply!: () => void;
  const control = installMineruLayout({ current: () => ({ document: { id: 'a', workspaceId: 'ws', name: 'a.pdf' }, ready: true }), progress: () => {}, notice: () => {}, apply: () => new Promise(resolve => { finishApply = resolve; }), call: async name => ({ _meta: name === 'pdf_workspace_layout_read' ? { layoutAnnotations: [] } : { layoutStatus: { phase: 'completed', token: 'a', figures: 0, tables: 0, equations: 0, completedPages: 1, totalPages: 1, modelVersion: 'MinerU 本机' } } }) });
  const request = control.ensure();
  await new Promise(resolve => setImmediate(resolve));
  control.stop(); finishApply(); await request;
  assert.equal(timers.size, 0);
});
