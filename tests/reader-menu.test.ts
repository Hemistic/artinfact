import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerAnalysisMenu } from '../src/shared/reader-menu.ts';
import { installMineruStatus } from '../src/ui/mineru-panel.ts';

test('reader menu labels conversion success, real segment progress and independent layout status', () => {
  const idle = readerAnalysisMenu({ documentId: 'a', phase: 'idle' });
  assert.equal(idle.convertLabel, '转化 Markdown'); assert.equal(idle.convertDisabled, false);
  const done = readerAnalysisMenu({ documentId: 'a', phase: 'completed' }, { phase: 'completed', completedPages: 16, totalPages: 16, figures: 3, tables: 9, equations: 1, modelVersion: 'test' });
  assert.equal(done.convertLabel, '重新转换 Markdown'); assert.match(done.statusLabel, /转换成功/);
  assert.equal(done.layoutLabel, '布局解析'); assert.equal(done.layoutDetail, '已完成'); assert.match(done.layoutTitle, /图片 3.*表格 9.*公式 1/);
  const running = readerAnalysisMenu({ documentId: 'a', phase: 'parsing', segments: { completed: 1, total: 3 } }, { phase: 'running', completedPages: 2, totalPages: 16, figures: 0, tables: 0, equations: 0, modelVersion: 'test' });
  assert.equal(running.convertDisabled, true); assert.match(running.statusLabel, /已完成 1\/3 段/);
  assert.equal(running.layoutDisabled, true); assert.equal(running.layoutDetail, '2/16 页');
  assert.match(readerAnalysisMenu({ documentId: 'a', phase: 'failed', error: 'fetch failed' }).statusLabel, /失败.*fetch failed/);
  assert.equal(readerAnalysisMenu().convertDisabled, true);
});

test('reader conversion targets the current workspace, ignores double clicks and discards an old document reply', async () => {
  let doc = { id: 'a', workspaceId: 'ws-a', name: 'a.pdf' };
  const statuses: unknown[] = [], calls: { name: string; args: Record<string, unknown> }[] = [];
  let finish!: (value: unknown) => void;
  const controller = installMineruStatus({ current: () => ({ document: doc, ready: true }), progress: s => statuses.push(s), refresh: async () => {}, notice: () => {}, call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'pdf_workspace_mineru_convert') return new Promise(resolve => { finish = resolve; });
    return { _meta: { mineruStatus: { documentId: args.documentId, phase: 'completed' } } };
  } });
  controller.changed(); await new Promise(resolve => setImmediate(resolve));
  const request = controller.convert(); await controller.convert();
  assert.deepEqual(calls.filter(c => c.name === 'pdf_workspace_mineru_convert'), [{ name: 'pdf_workspace_mineru_convert', args: { workspaceId: 'ws-a', documentId: 'a' } }]);
  doc = { id: 'b', workspaceId: 'ws-b', name: 'b.pdf' }; controller.changed();
  const index = statuses.length;
  finish({ _meta: { mineruStatus: { documentId: 'a', phase: 'creating' } } }); await request;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(statuses.slice(index).every(s => !s || (s as { documentId: string }).documentId === 'b'));
  controller.stop();
});
