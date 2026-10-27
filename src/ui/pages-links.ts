import { pagesCard, openPagesOriginal, type PagesAssociation } from '../shared/pages-preview.js';
import type { ResearchDelivery } from '../shared/research-delivery.js';
import { setControlIcon, type UiIcon } from './icons.js';
import './pages-links.css';
type Host = { call(name: string, args: Record<string, unknown>): Promise<any>; run(action: () => Promise<unknown>): void; send(text: string): Promise<ResearchDelivery>; ask(label: string, value?: string, detail?: string): Promise<string | null>; openPage(pageId: string): Promise<void> };
// Only used to connect/import an unbound local note. Bound entries open Pages directly.
export function installPagesLinks(container: HTMLElement, host: Host) {
  const toolbar = document.createElement('nav'); toolbar.className = 'pages-toolbar'; toolbar.setAttribute('aria-label', 'Pages 关联工具栏');
  const info = document.createElement('p'); info.className = 'pages-info'; info.setAttribute('role', 'status');
  container.append(toolbar, info);
  let current: { workspaceId: string; name: string } | undefined, state: PagesAssociation | undefined, epoch = 0, pollBusy = false, actionBusy = false, referenceOnly = false;
  function button(label: string, icon: UiIcon, action: () => Promise<unknown>) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = label; setControlIcon(b, icon); b.onclick = () => host.run(action); return b; }
  const create = button('保存到 Pages', 'upload', () => request('create'));
  const connect = button('关联 Pages', 'browser', async () => { const ref = await host.ask('关联 Pages 页面', state?.cache?.url || '', '填写 Pages 原页面链接或页面 ID。完成关联后，点击条目直接打开 Pages。'); if (ref) await request('refresh', ref); });
  const refresh = button('同步 Pages 缩略内容', 'refresh', () => request('refresh'));
  const original = button('在 App 中打开 Pages', 'arrow', async () => { if (state) { original.disabled = true; try { await openPagesOriginal(state, host.openPage); } finally { original.disabled = false; } } });
  const cancel = button('取消同步请求', 'close', async () => { if (!current || !state?.request) return; await host.call('pdf_pages_request_fail', { ...scope(), requestId: state.request.id, error: '用户取消同步请求' }); await load(); });
  toolbar.append(create, connect, refresh, original, cancel);
  const scope = () => ({ workspaceId: current!.workspaceId, name: current!.name });
  function display() {
    if (!current) return;
    const card = state ? pagesCard(state) : undefined, requestState = state?.request, pending = requestState?.status === 'pending';
    container.querySelector('header strong')!.textContent = card?.title || state?.localTitle || current.name;
    create.hidden = referenceOnly || !!card; create.disabled = connect.disabled = refresh.disabled = actionBusy || pending;
    refresh.hidden = original.hidden = !card; cancel.hidden = !pending;
    info.textContent = (card ? '阅读和编辑请直接打开 Pages。' : referenceOnly ? '引用已有 Pages；笔记正文仍保存在白板卡片中。' : '将整张白板组装为 Markdown，主动导出到私有 Pages。')
      + (pending ? requestState.delivery === 'sent' ? ' 请求已发送，等待 Agent 同步。' : requestState.delivery === 'draft' ? ' 请求已放入聊天输入框，请发送。' : ' 请求待处理，请在聊天中发送。' : requestState?.status === 'failed' ? ' 同步失败：' + requestState.error : '')
      + (state?.localChanged ? ' 白板内容已有更新；Pages 原页面保留。' : '');
  }
  async function load() { if (!current) return; const captured = epoch; const result = await host.call('pdf_workspace_pages_read', scope()); if (captured !== epoch) return; state = result._meta.pagesPreview; display(); }
  async function request(intent: 'create' | 'refresh', reference?: string) {
    if (!current || actionBusy) return; actionBusy = true; display(); const captured = epoch, args = scope();
    try {
      const result = (await host.call('pdf_workspace_pages_begin', { ...args, intent, ...(reference ? { reference } : {}) }))._meta.pagesPreview;
      const delivery = await host.send(result.prompt); await host.call('pdf_workspace_pages_delivery', { ...args, requestId: result.request.id, mode: delivery.mode });
      if (captured === epoch) await load();
    } finally { actionBusy = false; if (captured === epoch) display(); }
  }
  window.setInterval(() => { if (!current || container.hidden || pollBusy || state?.request?.status !== 'pending') return; pollBusy = true; void load().catch(e => { info.textContent = '读取同步状态失败：' + String(e); }).finally(() => { pollBusy = false; }); }, 2000);
  return {
    async open(workspaceId: string, name: string, references = false) { epoch++; referenceOnly = references; current = { workspaceId, name }; state = undefined; display(); await load(); },
  };
}
