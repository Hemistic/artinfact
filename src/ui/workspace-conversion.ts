import { showDropdown } from './dropdown.js';
import type { WorkspaceDocument } from '../server/workspaces.js';
import type { AnalysisStatus } from '../shared/mineru.js';
import { setControlIcon } from './icons.js';

type Scope = { workspaceId: string; name: string; documents: WorkspaceDocument[]; documentId?: string };
type Hooks = { call(name: string, args: Record<string, unknown>): Promise<any>; notice(text: string, error?: boolean): void };

export function installWorkspaceConversion(root: HTMLElement, hooks: Hooks) {
  const dialog = document.createElement('dialog'); dialog.className = 'workspace-conversion-dialog';
  dialog.setAttribute('aria-label', '本机解析');
  dialog.innerHTML = `<div class="dialog-title"><strong>本机解析</strong><button data-action="close" aria-label="关闭本机解析"></button></div>
    <p data-id="scope"></p><p class="conversion-help">使用独立安装的 MinerU 标准版，自动识别语言，一次生成 Markdown、结构 JSON、图表坐标；结果用于知识图谱与引用。</p>
    <div class="conversion-options"><label><input type="checkbox" data-id="ocr"> 强制 OCR（扫描件）</label></div>
    <p class="conversion-help">点击开始后，所选 PDF 在本机串行解析，不上传云端。已完成资料保留，失败任务可重试。</p>
    <div class="command-actions"><button class="primary" data-action="start">开始本机解析</button><button data-action="refresh">刷新进度</button></div>
    <p role="status" data-id="status"></p><div class="conversion-documents"></div>`;
  root.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`[data-id="${id}"]`)!;
  const btn = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  for (const [action, icon] of [['close', 'close'], ['start', 'refresh'], ['refresh', 'refresh']] as const) setControlIcon(btn(action), icon, action !== 'close');
  let scope: Scope | undefined, states: AnalysisStatus[] = [], epoch = 0, busy = false, polling = false, timer: ReturnType<typeof setTimeout> | undefined;
  const preferences = new Map<string, { isOcr: boolean }>();
  let submissionError = '';
  const documents = () => scope?.documents.filter(d => !scope?.documentId || d.id === scope.documentId) ?? [];
  const pending = () => documents().filter(d => { const state = states.find(s => s.documentId === d.id); return state && ['idle', 'failed'].includes(state.phase); });
  const report = (e: unknown) => { el('status').textContent = e instanceof Error ? e.message : String(e); };
  function render() {
    btn('start').disabled = busy || !pending().length;
    btn('refresh').disabled = busy || polling;
    const list = dialog.querySelector('.conversion-documents')!; list.replaceChildren();
    for (const doc of documents()) {
      const state = states.find(s => s.documentId === doc.id);
      const row = document.createElement('div'); row.className = 'conversion-document';
      const title = document.createElement('strong'); title.textContent = doc.name;
      const text = document.createElement('span');
      text.textContent = !state ? '正在读取状态' : state.phase === 'completed' ? '图谱资料已就绪' : state.engine === 'precision' || state.phase === 'idle' ? '尚未本机解析' : state.phase === 'failed' ? `转换失败：${state.error ?? '请重试'}` : state.label ?? '等待本机解析';
      row.append(title, text);
      if (state?.engine === 'lightweight' && state.segments) { const detail = document.createElement('small'); detail.textContent = `已完成 ${state.segments.completed}/${state.segments.total} 段${state.taskId ? ` · 任务 ${state.taskId}` : ''}${state.warning ? ` · ${state.warning}` : ''}`; row.append(detail); }
      list.append(row);
    }
  }
  async function poll() {
    clearTimeout(timer); if (!dialog.open || !scope || polling || busy) return;
    const mine = epoch, id = scope.workspaceId; polling = true; render();
    try {
      const result = await hooks.call('pdf_workspace_mineru_status', { workspaceId: id });
      if (mine !== epoch || !dialog.open) return;
      states = result._meta.mineruWorkspaceStatus.statuses;
      if (!busy) el('status').textContent = submissionError || (pending().length ? `${pending().length} 份 PDF 可转换` : documents().length ? '所选文件已有资料或正在处理' : '请先添加 PDF');
    } catch (e) { if (mine === epoch) report(e); }
    finally { polling = false; if (dialog.open) { render(); timer = setTimeout(() => void poll(), mine === epoch ? 3000 : 0); } }
  }
  async function start() {
    if (busy || !scope) return; const selected = pending(); if (!selected.length) return;
    const id = scope.workspaceId, mine = epoch; busy = true; clearTimeout(timer); submissionError = ''; el('status').textContent = `正在准备 ${selected.length} 份 PDF…`; render();
    const options = { modelVersion: 'pipeline' as const, isOcr: el<HTMLInputElement>('ocr').checked };
    preferences.set(id, options);
    try {
      const result = await hooks.call('pdf_workspace_mineru_batch', { workspaceId: id, documentIds: selected.map(d => d.id), options });
      if (mine === epoch) el('status').textContent = `已加入本机标准解析队列：${result._meta.mineruBatch.jobs.length} 份 PDF`;
    } catch (e) { if (mine === epoch) { submissionError = e instanceof Error ? e.message : String(e); report(e); } else hooks.notice(e instanceof Error ? e.message : String(e), true); }
    finally { busy = false; if (dialog.open && mine === epoch) { render(); void poll(); } }
  }
  btn('close').onclick = () => dialog.close();
  dialog.onclose = () => { epoch++; clearTimeout(timer); };
  btn('refresh').onclick = () => void poll(); btn('start').onclick = () => void start();
  return { show(value: Scope) {
    scope = value; epoch++; states = []; submissionError = ''; el('status').textContent = '正在读取状态';
    el('scope').textContent = value.documentId ? `${value.name} · ${value.documents.find(d => d.id === value.documentId)?.name ?? ''}` : `${value.name} · ${value.documents.length} 份 PDF`;
    const saved = preferences.get(value.workspaceId); el<HTMLInputElement>('ocr').checked = saved?.isOcr ?? false;
    if (!dialog.open) showDropdown(dialog); render(); void poll();
  } };
}
