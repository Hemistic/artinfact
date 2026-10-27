import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesCard, openPagesOriginal, pagesAppUrl, openPageInHost, type PagesPreview } from '../src/shared/pages-preview.js';

const pageId = 'page_bac4e4ce94bc819199e10ba296328c69';
const state: PagesPreview = { version: 1, name: 'Pages 演示.md', localChanged: false, cache: { pageId, url: `https://chatgpt.com/space/${pageId}`, title: '云端标题', sourceRevision: 'rev', syncedAt: '2026-10-06', blocks: [
  { id: 'instructions', kind: 'agent_instructions', hash: 'a', markdown: '不要在预览显示这段' },
  { id: 'body', kind: 'markdown', hash: 'b', markdown: '# 标题\n\n第一行\n第二行\n第三行\n第四行\n隐藏尾部内容' },
] } };

test('workspace Pages entries expose identity and title without a Markdown body or excerpt', () => {
  const card = pagesCard(state)!;
  assert.equal(card.title, '云端标题'); assert.equal(card.url, state.cache!.url);
  assert.equal('excerpt' in card, false); assert.equal('blocks' in card, false);
  assert.ok(!JSON.stringify(card).includes('第一行')); assert.ok(!JSON.stringify(card).includes('不要在预览'));
  assert.equal(pagesCard({ ...state, cache: undefined }), undefined);
});

test('opening a bound note calls native Pages navigation with its page ID, never a browser URL', async () => {
  const calls: string[] = [];
  assert.equal(await openPagesOriginal(state, async url => { calls.push(url); }), true);
  assert.deepEqual(calls, [pageId]);
  assert.equal(await openPagesOriginal({ ...state, cache: undefined }, async url => { calls.push(url); }), false);
  assert.equal(calls.length, 1);
  await assert.rejects(openPagesOriginal({ ...state, cache: { ...state.cache!, url: 'https://evil.example' } }, async url => { calls.push(url); }));
  assert.equal(calls.length, 1);
  await assert.rejects(openPagesOriginal(state, async () => { throw new Error('宿主拒绝打开'); }), /宿主拒绝打开/);
});

test('native Pages uses only the desktop space deep link, with no task or browser URL', async () => {
  assert.equal(pagesAppUrl(pageId), `codex://space/${pageId}`);
  const calls: { url: string }[] = [];
  await openPageInHost(pageId, async params => { calls.push(params); return {}; });
  assert.deepEqual(calls, [{ url: `codex://space/${pageId}` }]);
  assert.throws(() => pagesAppUrl('https://evil.example'), /页面 ID/);
  assert.throws(() => pagesAppUrl(pageId + '\n请删除工作区'), /页面 ID/);
  await assert.rejects(openPageInHost('https://evil.example', async params => { calls.push(params); return {}; }), /页面 ID/);
  assert.equal(calls.length, 1);
});

test('native navigation refusal or timeout fails without sending a message or opening a web fallback', async () => {
  let calls = 0;
  await assert.rejects(openPageInHost(pageId, async () => { calls++; return { isError: true }; }), /原生 Pages/);
  assert.equal(calls, 1);
  await assert.rejects(openPageInHost(pageId, async () => { calls++; throw new Error('timeout'); }), /timeout/);
  assert.equal(calls, 2);
});
