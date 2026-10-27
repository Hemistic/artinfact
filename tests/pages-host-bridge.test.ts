import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { openPageInHost } from '../src/shared/pages-preview.js';

test('installed MCP Apps SDK sends a Pages deep link directly to open-link, without a chat message', async () => {
  const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  const view = new App({ name: 'Pages navigation test', version: '1' }, {}, { autoResize: false });
  const host = new AppBridge(null, { name: 'test host', version: '1' }, { openLinks: {}, message: { text: {} } });
  const links: string[] = []; let messages = 0, rejectNext = false;
  host.onopenlink = async ({ url }) => { links.push(url); return { isError: rejectNext }; };
  host.onmessage = async () => { messages++; return {}; };
  try {
    await host.connect(hostTransport); await view.connect(viewTransport);
    await openPageInHost('page_bac4e4ce94bc819199e10ba296328c69', params => view.openLink(params));
    assert.deepEqual(links, ['codex://space/page_bac4e4ce94bc819199e10ba296328c69']);
    assert.equal(messages, 0);
    rejectNext = true;
    await assert.rejects(openPageInHost('page_bac4e4ce94bc819199e10ba296328c69', params => view.openLink(params)), /原生 Pages/);
    assert.equal(messages, 0);
  } finally { await viewTransport.close(); await hostTransport.close(); }
});
