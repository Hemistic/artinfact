import {installUiAffordances} from '../shared/ui-affordances.js';
installUiAffordances(document);
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import '@openai/mcp-extensions/app/styles.css';
import './style.css';
import { applicationMessage, createPreset, ProfileSchema, friendlyError, type Profile, type Panel, type Target, type Snapshot, type LayoutPlan } from '../shared/profile.js';
import { iconMarkup, type UiIcon } from './icons.js';
import { PLUGIN_VERSION } from '../shared/version.js';

// A persistent work surface uses the size assigned by the host. Content changes must not resize its surrounding chat.
const app = new App({ name: 'Artinfact', version: PLUGIN_VERSION }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const preview = window.top === window.self && new URLSearchParams(location.search).get('preview') === '1';
const surface = document.documentElement.dataset.surface === 'conversation' || (preview && new URLSearchParams(location.search).get('surface') === 'conversation') ? 'conversation' : 'sidebar';
document.documentElement.dataset.surface = surface;
const root = document.querySelector<HTMLDivElement>('#app')!;
localizeInitialMarkup();
let data: Snapshot | undefined;
let draft: Profile = createPreset('develop');
let dirty = false;
let busy = false;
let connected = false;
let selected = 'develop';
let status = '';
let statusError = false;
let lastRequest = '';
let projectInput = '';

function icon(name: string, className = '') { return iconMarkup(name as UiIcon, className); }
function escape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
function targetLabel(target: Target) {
  if (target.type === 'file') return target.path || '选择一个文件';
  if (target.type === 'browser') return target.url || '输入网页地址';
  if (target.type === 'terminal') return '终端';
  return ({ 'last-turn': '最近改动', branch: '分支改动', unstaged: '未暂存改动', staged: '已暂存改动' })[target.view];
}
const labels = { file: '文件', browser: '浏览器', terminal: '终端', review: '审查' };
function toast(message: string, error = false) { status = message; statusError = error; updateStatus(); }
function updateStatus() {
  const element = root.querySelector<HTMLDivElement>('#notice');
  if (element) { element.textContent = status; element.className = `notice ${statusError ? 'error' : 'success'}`; element.hidden = !status; }
  root.querySelector('#dirty')!.textContent = dirty ? '未保存的更改' : data?.workspace ? '待校验' : '先选择项目';
}
function diagram() {
  function tabs(placement: Panel['placement']) {
    const panels = draft.panels.filter(panel => panel.placement === placement);
    return panels.length ? panels.map(panel => `<div class="position-target">${icon(panel.target.type)}<span>${escape(targetLabel(panel.target))}</span></div>`).join('') : '<span class="position-empty">没有配置要打开的面板</span>';
  }
  return `<div class="position-map"><div class="native-boundary">${icon('layout')}<div><strong>Codex 原生工作界面</strong><span>聊天区与输入框由 Codex 管理</span></div></div>
    <div class="position-zone"><strong>右侧打开</strong>${tabs('right')}</div>
    <div class="position-zone"><strong>底部打开</strong>${tabs('bottom')}</div></div>`;
}
function panelEditor(panel: Panel, index: number) {
  let field = '';
  if (panel.target.type === 'file') field = `<label class="sr-only" for="target-${index}">文件路径</label><input id="target-${index}" data-field="path" data-index="${index}" value="${escape(panel.target.path)}" placeholder="项目内路径或文件绝对路径" spellcheck="false" />`;
  if (panel.target.type === 'browser') field = `<label class="sr-only" for="target-${index}">网页地址</label><input id="target-${index}" data-field="url" data-index="${index}" value="${escape(panel.target.url)}" placeholder="https://… 或 http://localhost:5173" spellcheck="false" />`;
  if (panel.target.type === 'terminal') field = '<div class="terminal-note">使用当前聊天的终端目录</div>';
  if (panel.target.type === 'review') field = `<label class="sr-only" for="target-${index}">审查范围</label><select id="target-${index}" data-field="view" data-index="${index}">${Object.entries({ unstaged: '未暂存改动', staged: '已暂存改动', 'last-turn': '最近改动', branch: '分支改动' }).map(([value, label]) => `<option value="${value}" ${panel.target.type === 'review' && panel.target.view === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  return `<div class="panel-row"><div class="target-icon ${panel.target.type}">${icon(panel.target.type)}</div><div class="panel-fields"><div class="panel-kind">${labels[panel.target.type]}<span>${String(index + 1).padStart(2, '0')}</span></div>${field}</div>
    <div class="placement" role="group" aria-label="${labels[panel.target.type]}位置"><button data-action="position" data-index="${index}" data-position="right" class="${panel.placement === 'right' ? 'active' : ''}" aria-pressed="${panel.placement === 'right'}">右侧</button><button data-action="position" data-index="${index}" data-position="bottom" class="${panel.placement === 'bottom' ? 'active' : ''}" aria-pressed="${panel.placement === 'bottom'}">底部</button></div>
    <button class="icon-button remove" data-action="remove" data-index="${index}" aria-label="移除${labels[panel.target.type]}面板">${icon('trash')}</button></div>`;
}
function render() {
  const presets = [{ id: 'develop', name: '开发', description: '文件在侧，预览在下', glyph: 'layout' }, { id: 'read', name: '查阅', description: '资料与聊天并排', glyph: 'browser' }, { id: 'review', name: '审查', description: '专注查看代码改动', glyph: 'review' }];
  root.innerHTML = `<div class="app-shell">
    <header class="header"><div class="brand"><div class="brand-mark">${icon('layout')}</div><div><strong>工作面板配置</strong><span>${surface === 'conversation' ? '当前聊天的配置面板' : '独立 Sidebar App'}</span></div></div><div class="header-actions"><span class="connection"><i class="${connected ? 'online' : ''}"></i>${preview ? '浏览器预览' : connected ? '已连接桌面' : '连接中'}</span><button class="icon-button" data-action="reload" aria-label="刷新预设">${icon('refresh')}</button></div></header>
    <div class="body"><nav class="template-bar" aria-label="布局预设"><div class="template-group"><span class="nav-label">模板</span>${presets.map(preset => `<button class="preset ${selected === preset.id ? 'selected' : ''}" data-action="preset" data-preset="${preset.id}" title="${preset.description}">${icon(preset.glyph)}<strong>${preset.name}</strong></button>`).join('')}</div>
    <div class="saved-group"><span class="nav-label">已保存 ${data?.profiles.length ?? 0}</span><div class="saved-list">${data?.profiles.length ? data.profiles.map((profile, i) => `<button class="saved ${selected === `saved:${profile.name}` ? 'selected' : ''}" data-action="load" data-index="${i}">${icon('layout')}<span>${escape(profile.name)}</span><small>${profile.panels.length}</small></button>`).join('') : `<span class="empty-saved">${data?.workspace ? '此项目暂无预设' : '选择项目后可保存预设'}</span>`}</div></div></nav>
    <main><div class="scope-note"><strong>此页管理面板的打开位置</strong><span>聊天、输入框和外围导航由 Codex 管理。</span></div>
    <section class="workspace-section"><label class="field-label" for="workspace">1. 选择项目</label><div class="workspace-field"><input id="workspace" value="${escape(projectInput)}" placeholder="输入项目绝对路径，例如 D:\\Project\\my-app" spellcheck="false" /><button class="secondary" data-action="workspace">切换项目</button></div><p id="project-hint"></p></section>
    <div class="config-grid"><section class="editor-section"><div class="section-title"><h2>2. 面板与位置</h2><span id="dirty"></span></div><label class="field-label" for="profile-name">预设名称</label><input class="name-input" id="profile-name" data-field="name" value="${escape(draft.name)}" maxlength="80" />
    <div class="panel-list">${draft.panels.map(panelEditor).join('')}</div><div class="add-row"><label class="sr-only" for="new-type">新增面板类型</label><select id="new-type"><option value="file">文件</option><option value="browser">浏览器</option><option value="terminal">终端</option><option value="review">审查</option></select><button class="text-button" data-action="add">${icon('plus')}添加面板</button></div></section>
    <details class="preview-section" ${surface === 'sidebar' ? 'open' : ''}><summary class="section-title"><h2>待打开的面板</h2><span>展开／收起</span></summary><div id="diagram">${diagram()}</div><div class="preview-help"><p>同一区域可有多个标签页。执行后，在 Codex 中拖动分隔线调整宽高。</p></div></details></div>
    <div class="execution-note"><strong>3. 打开面板</strong><p>${surface === 'conversation' ? '请求会发送到当前聊天，由 Codex 打开指定面板。' : '全局 App 有自己的聊天。按钮会在 App 聊天中打开面板；要用于原来的聊天，复制请求并粘贴到目标聊天。'}</p></div>
    <div id="notice" role="status" aria-live="polite" hidden></div><div class="action-bar"><div class="secondary-actions"><button class="secondary" data-action="save">${icon('save')}保存预设</button><button class="secondary" data-action="copy">${icon('copy')}复制请求</button>${selected.startsWith('saved:') ? `<button class="icon-button" data-action="delete" aria-label="删除当前预设" title="删除当前预设">${icon('trash')}</button>` : ''}</div><button class="primary" data-action="apply">${preview ? '校验布局' : surface === 'conversation' ? '在当前聊天打开面板' : '在 App 聊天打开面板'}${icon('arrow')}</button></div>
    <div class="footer-note">${icon('check')}选择位置只编辑草稿。保存预设供下次使用，打开面板才会执行。</div>
    </main></div></div>`;
  updateStatus();
  setBusy(busy);
}
function setBusy(value: boolean) {
  busy = value;
  root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(element => { element.disabled = value; });
  const ready = Boolean(data?.workspace) && projectInput === data?.workspace;
  for (const action of ['save', 'copy', 'delete', 'apply']) {
    const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button) button.disabled = value || !ready || (!preview && !connected);
  }
  root.querySelector<HTMLButtonElement>('[data-action="workspace"]')!.disabled = value || !projectInput.trim();
  root.querySelector<HTMLButtonElement>('[data-action="add"]')!.disabled = value || draft.panels.length >= 20;
  root.querySelector('#project-hint')!.textContent = !data?.workspace ? '先选择真实项目，用于解析文件路径和保存预设。' : !ready ? '目录已修改，请点击「切换项目」载入。' : '用于解析文件路径和保存预设；不会更改聊天或终端的工作目录。';
}
function setSnapshot(value: Snapshot, reset = false) {
  data = value;
  projectInput = value.workspace;
  if (reset) { draft = createPreset('develop', value.suggestedFile); selected = 'develop'; dirty = false; }
  render();
}
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown };
  if (preview) {
    const response = await fetch('/preview/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
    result = await response.json();
  } else result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '操作未完成');
  if (result.structuredContent) return result.structuredContent as T;
  const text = result.content?.find(item => item.type === 'text')?.text;
  if (text) return JSON.parse(text) as T;
  throw new Error('没有收到有效结果');
}
function workspace() {
  const value = root.querySelector<HTMLInputElement>('#workspace')!.value.trim();
  if (!value) throw new Error('请先指定当前项目目录');
  if (data && value !== data.workspace) throw new Error('项目目录已修改，请先点击「切换」再保存或应用');
  return value;
}
async function plan() {
  const validation = ProfileSchema.safeParse(draft);
  if (!validation.success) throw new Error(friendlyError(validation.error));
  const result = await call<LayoutPlan>('layout_plan', { workspace: workspace(), profile: draft });
  lastRequest = applicationMessage(result);
  return result;
}
root.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'workspace') { projectInput = input.value.trim(); lastRequest = ''; setBusy(busy); return; }
  if (!input.dataset.field) return;
  if (input.dataset.field === 'name') draft.name = input.value;
  else {
    const panel = draft.panels[Number(input.dataset.index)];
    if (input.dataset.field === 'path' && panel.target.type === 'file') panel.target.path = input.value;
    if (input.dataset.field === 'url' && panel.target.type === 'browser') panel.target.url = input.value;
    if (input.dataset.field === 'view' && panel.target.type === 'review') panel.target.view = input.value as typeof panel.target.view;
  }
  dirty = true;
  lastRequest = '';
  root.querySelector('#diagram')!.innerHTML = diagram();
  updateStatus();
});
root.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || busy) return;
  const action = button.dataset.action;
  if (action === 'preset') {
    selected = button.dataset.preset!;
    draft = createPreset(selected as 'develop' | 'read' | 'review', data?.suggestedFile);
    dirty = false; status = ''; lastRequest = ''; render(); return;
  }
  if (action === 'load') {
    draft = structuredClone(data!.profiles[Number(button.dataset.index)]);
    selected = `saved:${draft.name}`; dirty = false; status = ''; lastRequest = ''; render(); return;
  }
  if (action === 'position') { draft.panels[Number(button.dataset.index)].placement = button.dataset.position as Panel['placement']; dirty = true; lastRequest = ''; render(); return; }
  if (action === 'remove') { draft.panels.splice(Number(button.dataset.index), 1); dirty = true; lastRequest = ''; render(); return; }
  if (action === 'add') {
    const kind = root.querySelector<HTMLSelectElement>('#new-type')!.value;
    const target: Target = kind === 'file' ? { type: 'file', path: '' } : kind === 'browser' ? { type: 'browser', url: '' } : kind === 'review' ? { type: 'review', view: 'unstaged' } : { type: 'terminal' };
    draft.panels.push({ placement: kind === 'file' || kind === 'review' ? 'right' : 'bottom', target });
    dirty = true; lastRequest = ''; render(); return;
  }
  setBusy(true);
  try {
    if (action === 'workspace' || action === 'reload') {
      const value = root.querySelector<HTMLInputElement>('#workspace')!.value.trim();
      if (action === 'workspace' && !value) throw new Error('请输入真正的项目绝对路径');
      const result = await call<Snapshot>('layout_list', value ? { workspace: value } : {});
      setSnapshot(result, action === 'workspace' || !data);
      toast(action === 'workspace' ? '已切换项目，载入该项目的预设。' : '预设已刷新。');
    }
    if (action === 'save') {
      const validation = ProfileSchema.safeParse(draft);
      if (!validation.success) throw new Error(friendlyError(validation.error));
      const result = await call<Snapshot>('layout_save', { workspace: workspace(), profile: draft });
      dirty = false; selected = `saved:${draft.name}`; setSnapshot(result);
      toast(`已保存「${draft.name}」。要执行此布局，请点击打开面板。`);
    }
    if (action === 'delete') {
      const name = selected.slice('saved:'.length);
      const result = await call<Snapshot>('layout_delete', { workspace: workspace(), name });
      selected = 'custom'; dirty = true; setSnapshot(result);
      toast(`已删除「${name}」的已保存预设，当前草稿仍保留。`);
    }
    if (action === 'copy') {
      await plan();
      await navigator.clipboard.writeText(lastRequest);
      toast('布局请求已复制，可粘贴到你希望调整的聊天。');
    }
    if (action === 'apply') {
      await plan();
      if (preview) toast('布局校验通过。浏览器预览不会改动桌面；请在 Sidebar App 中应用。');
      else {
        if (extensions.message) await extensions.message.send({ role: 'user', content: [{ type: 'text', text: lastRequest }] });
        else if (app.getHostCapabilities()?.message?.text) await app.sendMessage({ role: 'user', content: [{ type: 'text', text: lastRequest }] });
        else throw new Error('当前宿主未提供聊天消息接口；请使用「复制布局请求」再粘贴到聊天。');
        toast('已发送布局请求，执行结果将在当前聊天中显示。');
      }
    }
  } catch (error) { toast(error instanceof Error ? error.message : String(error), true); }
  finally { setBusy(false); }
});

function applyHost(context: ReturnType<App['getHostContext']>) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.onhostcontextchanged = context => applyHost(context);
app.ontoolresult = result => {
  const value = result.structuredContent as Snapshot | undefined;
  if (value && Array.isArray(value.profiles) && typeof value.workspace === 'string') setSnapshot(value, !data);
  else if (result.isError) toast(result.content?.find(item => item.type === 'text')?.text ?? '项目配置读取失败', true);
};
render();
if (preview) {
  connected = true;
  try { setSnapshot(await call<Snapshot>('layout_open', {}), true); }
  catch (error) { toast(error instanceof Error ? error.message : String(error), true); render(); }
} else {
  try {
    await app.connect(); connected = true; applyHost(app.getHostContext()); render();
  } catch (error) { toast(`无法连接桌面：${error instanceof Error ? error.message : String(error)}`, true); render(); }
}
import {localizeInitialMarkup} from './ui-language.js';
