import {installUiAffordances} from '../shared/ui-affordances.js';
installUiAffordances(document);
import {noteAiPrompt} from '../whiteboard/note-ai-provider.js';
import {withAiOutputLanguage} from '../shared/ai-output-language.js';
import {uiLanguage,setUiLanguage,localizeInitialMarkup,uiText,captureStaticChrome} from './ui-language.js';
import {installPdfCitationActions} from './pdf-citation-actions.js';
import { initializeDropdowns, rememberDropdownAnchor, showDropdown } from './dropdown.js';
import { sendSelectionTranslation } from '../shared/selection-codex.js';
import { installMineruLayout } from './mineru-layout.js';
import { installLocalMineruSettings } from './mineru-local-settings.js';
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import './pdf.css';
import {callWithTransportRetry,isTransportClosed} from '../shared/mcp-connection.js';
import {PdfSaveOutbox,type PdfSaveIntent} from '../shared/pdf-save-outbox.js';
import { ContextQueue, normalizeSelection, selectionContext, selectionLabel, type PdfDocument, type PdfSelection } from '../shared/pdf-selection.js';
import { extractCitationNumbers, type SelectionReferences } from '../shared/pdf-references.js';
import { PLUGIN_VERSION } from '../shared/version.js';
import { readHostReaderPalette, GPT_PALETTES } from './reader-theme.js';
import { effectiveAppearance, normalizeAppearance, type ReaderAppearance } from '../shared/reader-preferences.js';
import type { PdfState, PdfPatch } from '../server/pdf-store.js';
import type { OpenPdf } from '../server/reader-service.js';
import { installMineruStatus } from './mineru-panel.js';
import type { NodeContext } from '../shared/mineru.js';
import { iconMarkup, setControlIcon, type UiIcon } from './icons.js';
import { installWorkspaceShell } from './workspace-shell.js';
import {toolTimeout} from '../shared/tool-timeout.js';
import { installWhiteboardPanel } from './whiteboard-panel.js';
import { installResearchPanel } from './research-panel.js';
import {createPdfEvidenceNavigation} from './pdf-evidence.js';
import { deliverResearchMessage, type ResearchDelivery } from '../shared/research-delivery.js';
import { openPageInHost, pagesAppUrl } from '../shared/pages-preview.js';
import { DEFAULT_TRANSLATION_PREFERENCES, TRANSLATION_TARGET_CODES, TRANSLATION_TARGET_NAMES, replyToSelectionLookup, type TranslationPreferences } from '../shared/selection-translation.js';

const app = new App({ name: 'Artinfact', version: PLUGIN_VERSION }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false });
const extensions = new OpenAIExtensions(app);
initializeDropdowns(document);
const preview = window.top === window.self && new URLSearchParams(location.search).get('preview') === '1';
let initialConfig:Config|undefined,bootstrapConnected=preview,bootstrapError:unknown;
app.ontoolresult=result=>{initialConfig=result._meta?.pdfReader as Config|undefined;};
try{
 if(!preview){await app.connect();bootstrapConnected=true;}
 const response=preview?await fetch('/preview/pdf-tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'pdf_ui_language_read',arguments:{}})}).then(r=>r.json()):await app.callServerTool({name:'pdf_ui_language_read',arguments:{}},{timeout:15000});
 const language=response._meta?.uiLanguage;if(language==='zh'||language==='en')setUiLanguage(language);
}catch(error){bootstrapError=error;}
if (preview) {
  const selected = new URLSearchParams(location.search).get('theme');
  const theme = selected === 'light' || selected === 'dark' ? selected : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyDocumentTheme(theme); document.documentElement.dataset.theme = theme;
}
// Local browser diagnostics stay separate from the model context and omit tool arguments.
const diagnostics = { status: '正在连接阅读器…', context: '', selection: null as PdfSelection | null, calls: [] as { name: string; ms: number; error?: string }[] };
if (preview) Object.defineProperty(window, 'codexPdfDebug', { get: () => ({ ...structuredClone({ ...diagnostics, ready, opening, document: documentInfo }), applyHostContext: applyHost }) });
type Config = { baseUrl: string; workspace?: string; workspaceId?:string; dataDirectory?: string; document?: OpenPdf; markdown?: { workspaceId: string; name: string }; hostFile?: { name: string; resourceUri: string } };
let config: Config | undefined;
let documentInfo: PdfDocument | undefined;
let selection: PdfSelection | null = null;
let buffer: ArrayBuffer | undefined;
let state: PdfState | undefined;
let frame: HTMLIFrameElement | undefined;
let frameToken = '';
let runtimePromise: Promise<string> | undefined;
let loadWaiter:{resolve():void;reject(error:Error):void}|undefined;
const readerLoading=document.createElement('div');readerLoading.className='reader-loading';readerLoading.hidden=true;readerLoading.setAttribute('role','status');
function loading(text:string){readerLoading.textContent=text;readerLoading.hidden=false;setStatus(text);}
let generation = 0;
let ready = false;let stateRestored=false;let shellReady=false;
let connected = bootstrapConnected;
let preferencesReady = false;
let appearance: ReaderAppearance | null = null;
let preferencesTail: Promise<void> = Promise.resolve();
let translationPreferences: TranslationPreferences = { ...DEFAULT_TRANSLATION_PREFERENCES };
let translationPreferencesTail: Promise<unknown> = Promise.resolve();
let codexTranslationSending = false;
let hostPalette = readHostReaderPalette(document);
let lastReaderSettings = '';
let opening = false;
let contextUsed = false;
let saveTail: Promise<void> = Promise.resolve();
const intents: (PdfSaveIntent & {key?:string})[] = [];
let saveOutbox:PdfSaveOutbox|undefined;
let outboxRoot='';
let connectionLost=false;
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let viewPatch: PdfPatch | undefined;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
const flushWaiters = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const readerWaiters = new Map<string, { resolve(value: object): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<section class="stage" id="stage"><div class="empty" id="empty"><div class="symbol">${iconMarkup("book")}</div><h1>打开 PDF</h1><p>选中文字会自动同步到 Codex，批注保存在本机。</p><div class="start-actions"><button id="choose" class="primary" disabled>选择文件</button><button id="path-toggle">填写文件路径</button></div><p id="empty-status">正在连接阅读器…</p><p class="shortcuts">Ctrl+O 打开文件 · Ctrl+Shift+O 文件与批注</p></div></section>
  <div id="banner" class="banner" role="status" aria-live="polite" hidden><span id="notice"></span><button id="retry" hidden>重试保存</button><button id="backup-pending" hidden>备份待保存批注</button><button id="dismiss" aria-label="关闭提示"></button></div>
  <dialog id="commands" aria-labelledby="commands-title"><div class="dialog-title"><strong id="commands-title">文件管理</strong><button id="commands-close" aria-label="关闭"></button></div><p id="current-file" class="current-file">未打开文件</p><div class="command-actions"><button id="choose-more" disabled>打开 PDF / 导入 Markdown</button><button id="close-pdf" disabled>关闭 PDF</button><button id="export-pdf" disabled>导出带批注 PDF</button></div><form class="path-row" id="path-row"><input id="path" aria-label="PDF / Markdown 文件绝对路径" placeholder="C:\\…\\文档.pdf" autocomplete="off"><button id="path-open" type="submit">打开</button></form><div class="command-actions"><button id="export" disabled>导出批注备份（JSON）</button><button id="import" disabled>导入批注备份</button></div><div class="command-actions"><button id="sync" disabled>重新同步选文</button><button id="copy" disabled>复制选文</button><button id="clear" disabled>清除选文上下文</button></div></dialog>
  <input id="pdf-input" type="file" accept="application/pdf,text/markdown,.pdf,.md" hidden><input id="json-input" type="file" accept="application/json,.json" hidden>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
const directories = document.createElement('p'); directories.id = 'directories'; directories.className = 'current-file'; directories.style.whiteSpace = 'pre-line'; $('current-file').after(directories);
const workspaceForm = document.createElement('form'); workspaceForm.id = 'workspace-settings';
workspaceForm.innerHTML = '<label for="workspace-directory">插件设置 · 默认工作目录</label><div class="path-row"><input id="workspace-directory" placeholder="填写已有文件夹的绝对路径" autocomplete="off"><button type="submit" id="workspace-save">保存目录</button></div><p id="workspace-notice" class="current-file">首次使用默认为你的文档文件夹下的 Artinfact；保存后立即生效，重新打开也会保留。</p>';
const workspaceDialog = document.createElement('dialog'); workspaceDialog.id = 'workspace-settings-dialog';
workspaceDialog.innerHTML = '<div class="dialog-title"><strong>工作目录</strong><button type="button" aria-label="关闭"></button></div>';
workspaceDialog.append(directories, workspaceForm); root.append(workspaceDialog);
setControlIcon(workspaceDialog.querySelector('button')!, 'close', false);
workspaceDialog.querySelector('button')!.onclick = () => workspaceDialog.close();
const settingsMenu = document.createElement('dialog'); settingsMenu.id = 'reader-settings-menu'; settingsMenu.setAttribute('aria-label', '设置');
root.append(settingsMenu);
const settingItems = [['files','文件管理','folder'],['notes','工作区笔记','notes'],['appearance','外观与纸面颜色','lightTheme'],['language','Language / 语言','translate'],['translation','选文翻译','translate'],['processor','本机 MinerU','settings'],['workspace','工作目录','folder']] as const;
for (const [action,label,icon] of settingItems) {
  const item = document.createElement('button'); item.type = 'button'; item.dataset.action = action; item.textContent = label; setControlIcon(item,icon); settingsMenu.append(item);
  item.onclick = () => {
    if(action==='files') showCommands();
    else if(action==='workspace') { showCommands(); $<HTMLDialogElement>('commands').close(); showDropdown(workspaceDialog); }
    else if(action==='translation') showTranslationSettings();
    else if(action==='processor') processorSettings.show();
    else if(action==='appearance') {settingsMenu.close();post('codex-reader:open-appearance',{});}
    else if(action==='language') showLanguageSettings();
    else {settingsMenu.close();run(()=>workspaceShell.navigationAction('notes'));}
  };
}
function showSettings() { settingsMenu.querySelector<HTMLButtonElement>('[data-action=appearance]')!.disabled = !ready; showDropdown(settingsMenu); settingsMenu.querySelector<HTMLButtonElement>('button')?.focus(); }
const languageDialog=document.createElement('dialog');languageDialog.id='ui-language-settings';languageDialog.setAttribute('aria-label','Language / 语言');
languageDialog.innerHTML='<div class="dialog-title"><strong>Language / 语言</strong><button type="button" aria-label="关闭"></button></div><label for="ui-language-choice">界面语言</label><select id="ui-language-choice"><option value="zh">简体中文</option><option value="en">English</option></select><p role="status">切换前自动保存，内容保持原样。</p>';
root.append(languageDialog);setControlIcon(languageDialog.querySelector('button')!,'close',false);languageDialog.querySelector('button')!.onclick=()=>languageDialog.close();
function showLanguageSettings(){settingsMenu.close();languageDialog.querySelector<HTMLSelectElement>('select')!.value=uiLanguage();languageDialog.querySelector<HTMLElement>('[role=status]')!.textContent=uiText('切换前自动保存，内容保持原样。');showDropdown(languageDialog);}
languageDialog.querySelector<HTMLSelectElement>('select')!.onchange=event=>run(async()=>{
 const select=event.currentTarget as HTMLSelectElement,language=select.value as 'zh'|'en',previous=uiLanguage();if(language===previous)return;
 select.disabled=true;const status=languageDialog.querySelector<HTMLElement>('[role=status]')!;status.textContent=uiText('正在保存…');
 try{await workspaceShell.flushNotes();await whiteboardPanel.flush();await flush();await preferencesTail;await translationPreferencesTail;const response=await call('pdf_ui_language_update',{language});if(response._meta?.uiLanguage!==language)throw Error('Language preference was not saved');const doc=documentInfo,bytes=buffer;setUiLanguage(language);refreshStaticChrome();languageDialog.close();if(doc&&bytes){await withOpening(()=>openBytes(doc,bytes));await workspaceShell.opened(doc);}else await workspaceShell.showHome();}
 catch(error){select.value=previous;status.textContent=errorMessage(error);throw error;}finally{select.disabled=false;}
});

const processorSettings = installLocalMineruSettings(root, { call,progress:status=>post('codex-reader:processor-status',{status}) });
const translationForm = document.createElement('form'); translationForm.id = 'translation-settings';
translationForm.innerHTML = '<fieldset><legend>选文翻译</legend><label class="translation-enable"><input id="translation-enabled" type="checkbox" checked>划词／划句后自动翻译</label><div class="translation-options"><label>翻译服务<select id="translation-provider"><option value="bing">Bing（含词典）</option><option value="google">Google</option></select></label><label>翻译为<select id="translation-target"><option value="zh-Hans">简体中文</option><option value="en">英语</option><option value="ja">日语</option></select></label><button type="submit" id="translation-save">保存设置</button></div><p id="translation-notice" class="current-file">只发送选中文字到所选翻译服务。译文显示在选文浮窗中，可添加到批注或笔记。</p></fieldset>';
const translationDialog = document.createElement('dialog'); translationDialog.id = 'translation-dialog'; translationDialog.setAttribute('aria-labelledby', 'translation-dialog-title');
translationDialog.innerHTML = '<div class="dialog-title"><strong id="translation-dialog-title">选文翻译</strong><button type="button" id="translation-close" aria-label="关闭"></button></div>';
translationDialog.append(translationForm); root.append(translationDialog);
translationForm.querySelector('legend')?.remove();
setControlIcon($('translation-close'), 'close', false);
$('translation-close').onclick = () => translationDialog.close();
translationDialog.onclose = () => frame?.contentDocument?.getElementById('appearance')?.focus();
function showTranslationSettings() { renderTranslationPreferences(); if (!translationDialog.open) showDropdown(translationDialog); }
const targets = $<HTMLSelectElement>('translation-target'); targets.replaceChildren();
TRANSLATION_TARGET_CODES.forEach((code, i) => targets.add(new Option(TRANSLATION_TARGET_NAMES[i], code)));
$<HTMLSelectElement>('translation-provider').options[1]!.textContent = 'Google（含词典）';
function renderTranslationPreferences() {
  $<HTMLInputElement>('translation-enabled').checked = translationPreferences.enabled;
  $<HTMLSelectElement>('translation-provider').value = translationPreferences.provider;
  $<HTMLSelectElement>('translation-target').value = translationPreferences.target;
}
translationForm.onsubmit = event => { event.preventDefault(); run(async () => {
  const value: TranslationPreferences = { enabled: $<HTMLInputElement>('translation-enabled').checked, provider: $<HTMLSelectElement>('translation-provider').value as TranslationPreferences['provider'], target: $<HTMLSelectElement>('translation-target').value as TranslationPreferences['target'] };
  $<HTMLButtonElement>('translation-save').disabled = true;
  try {
    translationPreferencesTail = translationPreferencesTail.catch(() => undefined).then(() => call('pdf_translation_preferences_update', { preferences: value }));
    await translationPreferencesTail; translationPreferences = value;
    const settings = readerSettings(); lastReaderSettings = JSON.stringify(settings);
    // Palette notifications are handled separately by the adapter to avoid repainting PDF pages.
    post('electron-reader:apply-settings', { selectionTranslationEnabled: settings.selectionTranslationEnabled, selectionTranslationProvider: settings.selectionTranslationProvider, translationTarget: settings.translationTarget, translationFontSize: settings.translationFontSize });
    $('translation-notice').textContent = `已保存。${value.enabled ? '划选后自动显示译文' : '自动翻译已关闭'}；重新打开插件后保留。`;
  } finally { $<HTMLButtonElement>('translation-save').disabled = false; }
}); };
setControlIcon($('translation-save'), 'save');
for (const [id, icon] of Object.entries({ choose: 'folder', 'choose-more': 'folder', 'close-pdf': 'fileClose', 'export-pdf': 'download', export: 'download', import: 'upload', sync: 'refresh', copy: 'copy', clear: 'trash', retry: 'refresh', 'backup-pending':'download', 'path-open': 'fileInput', 'path-toggle': 'folder', 'workspace-save': 'save' }) as [string, UiIcon][]) setControlIcon($(id), icon);
setControlIcon($('dismiss'), 'close', false); setControlIcon($('commands-close'), 'close', false);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notice(text: string, error = false) { clearTimeout(noticeTimer); $('notice').textContent = text; $('banner').hidden = !text; $('banner').classList.toggle('error', error); if (text && !error) noticeTimer = setTimeout(() => { $('banner').hidden = true; }, 3500); }
function setStatus(text: string) { diagnostics.status = text; $('empty-status').textContent = text; }
function closeCommands() { $<HTMLDialogElement>('commands').close(); }
function showCommands() { directories.textContent = [config?.workspace ? `默认工作目录：${config.workspace}` : '', config?.dataDirectory ? `旧版存档与连接设置目录：${config.dataDirectory}` : ''].filter(Boolean).join('\n'); $<HTMLInputElement>('workspace-directory').value = config?.workspace ?? ''; const dialog = $<HTMLDialogElement>('commands'); if (!dialog.open) showDropdown(dialog); run(async () => { const value = (await call('layout_workspace_read', {})).structuredContent; if (config && value?.workspace) { config.workspace = value.workspace; $<HTMLInputElement>('workspace-directory').value = value.workspace; directories.textContent = `默认工作目录：${value.workspace}\nPDF 数据目录：${config.dataDirectory ?? ''}`; $('workspace-notice').textContent = value.environmentOverride ? '启动环境变量已指定目录；界面修改会保存，但下次启动仍优先使用环境变量。' : '首次使用默认为你的文档文件夹下的 Artinfact；保存后立即生效，重新打开也会保留。'; } }); }
workspaceForm.onsubmit = event => { event.preventDefault(); run(async () => {
  const path = $<HTMLInputElement>('workspace-directory').value.trim(); if (!path) throw new Error('请输入已有文件夹的绝对路径');
  $<HTMLButtonElement>('workspace-save').disabled = true;
  try { await suspendReader(); const value = (await call('layout_workspace_update', { workspace: path })).structuredContent; if (!value?.workspace || !config) throw new Error('工作目录未保存'); await workspaceShell.reset(); config.workspace = value.workspace; directories.textContent = `默认工作目录：${value.workspace}\nPDF 数据目录：${config.dataDirectory ?? ''}`; $('workspace-notice').textContent = value.environmentOverride ? '目录已保存并生效；下次启动的环境变量设置仍优先。' : '目录已保存并生效，重新打开插件后继续使用。'; }
  finally { $<HTMLButtonElement>('workspace-save').disabled = false; }
}); };
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function run(action: () => Promise<unknown>) { void action().catch(error => notice(errorMessage(error), true)); }
const taskDialog = document.createElement('dialog'); taskDialog.id = 'research-task';
taskDialog.innerHTML = '<div class="dialog-title"><strong>发送给 Codex</strong><button data-action="close" aria-label="关闭"></button></div><p role="status"></p><textarea readonly aria-label="完整研究任务" rows="7"></textarea><div class="command-actions"><button data-action="copy">复制任务</button></div><details><summary>发送诊断</summary><pre></pre></details>';
root.append(taskDialog);
setControlIcon(taskDialog.querySelector<HTMLButtonElement>('[data-action=close]')!, 'close', false);
setControlIcon(taskDialog.querySelector<HTMLButtonElement>('[data-action=copy]')!, 'copy');
taskDialog.querySelector<HTMLButtonElement>('[data-action=close]')!.onclick = () => taskDialog.close();
taskDialog.querySelector<HTMLButtonElement>('[data-action=copy]')!.onclick = () => run(async () => {
  const field = taskDialog.querySelector('textarea')!;
  try { await navigator.clipboard.writeText(field.value); taskDialog.querySelector('[role=status]')!.textContent = '任务已复制，请粘贴到 Codex 聊天并发送。'; }
  catch { field.focus(); field.select(); taskDialog.querySelector('[role=status]')!.textContent = '请按 Ctrl+C 复制选中的任务，粘贴到 Codex 聊天并发送。'; }
});
async function sendResearchMessage(text: string): Promise<ResearchDelivery> {
  text=withAiOutputLanguage(text,uiLanguage());
  const capabilities = app.getHostCapabilities();
  const message = capabilities?.experimental?.['openai/message'] as { draft?: object } | undefined;
  const record = async (mode: 'sent' | 'draft') => {
    const response = await fetch('/preview/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode }) });
    if (!response.ok) throw new Error('预览任务未接受'); return {};
  };
  const previewMode = new URLSearchParams(location.search).get('messageMode');
  const delivery = await deliverResearchMessage(text, preview ? {
    send: previewMode === 'manual' || previewMode === 'draft' ? undefined : () => record('sent'),
    draft: previewMode === 'draft' ? () => record('draft') : undefined,
  } : {
    send: extensions.message ? value => extensions.message!.send({ role: 'user', content: [{ type: 'text', text: value }], _meta: { 'openai/message': { target: 'active', send: true } } }, { timeout: 15000 }) : capabilities?.message?.text ? value => app.sendMessage({ role: 'user', content: [{ type: 'text', text: value }] }, { timeout: 15000 }) : undefined,
    // Codex advertises draft separately. This installed SDK release only validates send:true in its extension wrapper.
    draft: message?.draft ? value => {const request:Parameters<typeof app.sendMessage>[0]&{_meta:object}={role:'user',content:[{type:'text',text:value}],_meta:{'openai/message':{target:'active',send:false}}};return app.sendMessage(request,{timeout:10000});} : undefined,
  });
  if (delivery.mode !== 'sent') {
    taskDialog.querySelector('[role=status]')!.textContent = delivery.mode === 'draft' ? '任务已追加到当前视图的聊天输入框。请点击发送，Agent 会按提示词处理并显示结果。' : '宿主未能接收消息。请复制下方完整任务，粘贴到 Codex 聊天并发送，Agent 会按提示词处理并显示结果。';
    taskDialog.querySelector('textarea')!.value = text;
    taskDialog.querySelector('pre')!.textContent = JSON.stringify({ delivery: delivery.mode, reason: delivery.reason, host: app.getHostVersion(), message: !!capabilities?.message?.text, extensionsMessage: !!message, draft: !!message?.draft }, null, 2);
    if (!taskDialog.open) showDropdown(taskDialog);
  }
  return delivery;
}
function enable() { $('current-file').textContent = documentInfo?.name ?? '未打开文件'; for (const id of ['choose', 'choose-more', 'path-open']) $<HTMLButtonElement>(id).disabled = !connected || opening || !workspaceShell.currentWorkspace(); for (const id of ['export', 'import', 'export-pdf', 'close-pdf']) $<HTMLButtonElement>(id).disabled = !documentInfo || !ready || opening; for (const id of ['copy', 'clear']) $<HTMLButtonElement>(id).disabled = !selection || opening; $<HTMLButtonElement>('sync').disabled = !selection || !supportsContext() || opening; }
async function call(name: string, args: Record<string, unknown>) {
  if (/^pdf_(state_|export_|mineru_|selection_references)/.test(name) && !name.startsWith('pdf_mineru_settings_') && documentInfo?.workspaceId && !('workspaceId' in args)) args = { ...args, workspaceId: documentInfo.workspaceId };
  const started = performance.now(); let failure: string | undefined;
  try {
    const result = preview ? await fetch('/preview/pdf-tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }),signal:AbortSignal.timeout(toolTimeout(name)) }).then(r => r.json()) : await callWithTransportRetry(name,() => app.callServerTool({ name, arguments: args }, { timeout: toolTimeout(name) }));
    if (result.isError) throw new Error(result.content?.find((item: { type: string }) => item.type === 'text')?.text ?? '阅读器操作失败');
    if(connectionLost){connectionLost=false;if(intents.length)queueMicrotask(drain);}
    return result;
  } catch (error) { failure = errorMessage(error);if(isTransportClosed(error)){connectionLost=true;throw new Error('MCP 连接已中断，当前操作未确认完成。请重试；若仍无法连接，请备份待保存批注后重新打开 Artinfact。');} throw error; }
  finally { if (preview) { diagnostics.calls.push({ name, ms: Math.round(performance.now() - started), ...(failure ? { error: failure } : {}) }); if (diagnostics.calls.length > 100) diagnostics.calls.shift(); } }
}
function supportsContext() { return preview || !!extensions.modelContext || !!app.getHostCapabilities()?.updateModelContext?.text; }
const contextQueue = new ContextQueue<Parameters<App['updateModelContext']>[0]>(async value => {
  if (preview) {
    const response = await fetch('/preview/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const result = await response.json();
    if (!response.ok || result.isError) throw new Error('预览上下文写入失败'); return;
  }
  if (extensions.modelContext) { await extensions.modelContext.update(value); return; }
  if (app.getHostCapabilities()?.updateModelContext?.text) { await app.updateModelContext(value); return; }
  throw new Error('当前宿主未提供选文上下文接口，可复制引用到聊天');
});
function post(type: string, payload: object) { frame?.contentWindow?.postMessage({ type, payload, codexReaderToken: frameToken }, '*'); }
async function requestReader(type: string, payload: object) {
  if (!ready) throw new Error('阅读器尚未就绪');
  return new Promise<object>((resolve, reject) => {
    const requestId = crypto.randomUUID(); const timer = setTimeout(() => { readerWaiters.delete(requestId); reject(new Error('阅读器操作超时')); }, 30000);
    readerWaiters.set(requestId, { resolve, reject, timer }); post(type, { ...payload, requestId });
  });
}
async function injectNode(value: NodeContext) {
  if (!supportsContext()) throw new Error('宿主未提供上下文接口');
  contextUsed = true;
  await contextQueue.push({ ...value, structuredContent: { ...value.structuredContent, ...(documentInfo?.workspaceId ? { workspaceId: documentInfo.workspaceId } : {}) } });
  diagnostics.context = preview ? '预览已接收结构引用' : '已同步结构引用到 Codex';
}
const pdfEvidence=createPdfEvidenceNavigation(root,{call,open:async(ws,id)=>{await withOpening(()=>workspaceShell.open(ws,id));},navigate:position=>requestReader('codex-reader:navigate',{position}).then(()=>{}),notice,returnAvailable:available=>post('codex-reader:graph-return',{available})});
const analysis = installMineruStatus({ current: () => ({ document: documentInfo, ready }), call, notice, progress: status => post('codex-reader:analysis-status', { status }), refresh: async () => { layout.changed(); } });
const layout = installMineruLayout({ current: () => ({ document: documentInfo, ready }), call, notice,
  progress: status => { post('codex-reader:layout-status', { status });
  }, apply: async annotations => {
    const mine = generation; await flush();
    if (mine === generation && ready) {await requestReader('codex-reader:layout', { annotations });await citationActions.refreshIndex();}
  },
});
const researchPanel = installResearchPanel(root, { evidence:pdfEvidence.show, call, current: () => ({ document: documentInfo, ready }), send: sendResearchMessage, post, notice, run, suspend: suspendReader, home: () => workspaceShell.showHome(), open: (ws, id) => workspaceShell.open(ws, id), context: async value => { contextUsed = true; await contextQueue.push(value as Parameters<typeof contextQueue.push>[0]); }, refresh: async () => {
  const doc = documentInfo; if (!doc || !ready) return; const mine = generation; await flush(); const value = (await call('pdf_state_read', { documentId: doc.id, workspaceId: doc.workspaceId }))._meta?.pdfState;
  if (mine === generation && value) { state = value; post('electron-reader:sync-annotations', { annotations: state!.annotations }); }
} });
const citationActions=installPdfCitationActions({current:()=>({document:documentInfo,ready}),call,send:sendResearchMessage,post,notice,refreshWorkspace:()=>workspaceShell.refresh(),refreshAnnotations:async()=>{const doc=documentInfo;if(!doc?.workspaceId||!ready)return;const mine=generation;await flush();const value=(await call('pdf_state_read',{workspaceId:doc.workspaceId,documentId:doc.id}))._meta?.pdfState;if(mine===generation&&value){state=value;post('electron-reader:sync-annotations',{annotations:state!.annotations});}}});
function readerSettings() { return { theme: effectiveAppearance(hostPalette.scheme, appearance).scheme, gptPalette: hostPalette, appearance, uiLanguage: uiLanguage(), selectionTranslationEnabled: translationPreferences.enabled, selectionTranslationProvider: translationPreferences.provider, translationTarget: translationPreferences.target, translationFontSize: 16, bailianApiKey: '' }; }
function appearanceStyles() {
  const mode = effectiveAppearance(hostPalette.scheme, appearance).scheme;
  applyDocumentTheme(mode); document.documentElement.dataset.theme = mode;
  const p = mode === hostPalette.scheme ? hostPalette : GPT_PALETTES[mode];
  for (const [key, value] of Object.entries({ '--bg': p.background, '--fg': p.text, '--muted': p.muted, '--line': p.border, '--soft': p.secondary })) document.documentElement.style.setProperty(key, value);
}
async function readerRuntime(){
 if(!runtimePromise)runtimePromise=(async()=>{
  let packed=document.getElementById('artinfact-packed-reader')?.textContent||await readerRuntimeCache();
  if(!packed){
   const size=384*1024,read=async(offset:number)=>{const result=await call('pdf_runtime_read',{offset,length:size,encoding:'gzip-base64'});if(result.isError)throw Error(result.content?.[0]?.text||'Reader resource failed');const chunk=result._meta?.readerRuntime;if(!chunk||chunk.offset!==offset||typeof chunk.text!=='string'||chunk.total>16*1024*1024)throw Error('Reader resource range is invalid');return chunk;};
   const first=await read(0),parts=new Array(Math.ceil(first.total/size));parts[0]=first.text;let next=1;
   await Promise.all(Array.from({length:4},async()=>{while(next<parts.length){const index=next++,chunk=await read(index*size);if(chunk.total!==first.total||chunk.revision!==first.revision)throw Error('Reader resource changed during loading');parts[index]=chunk.text;}}));packed=parts.join('');
   if(packed.length!==first.total)throw Error('Reader resource is incomplete');void readerRuntimeCache(packed);
  }
  const bytes=Uint8Array.from(atob(packed),c=>c.charCodeAt(0)),html=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();if(html.length>64*1024*1024||!html.includes('__CODEX_READER_SESSION__'))throw Error('内置阅读器版本不匹配');return html;
 })().catch(error=>{runtimePromise=undefined;throw error;});return runtimePromise;
}
async function readerRuntimeCache(value?:string):Promise<string|undefined>{
 return new Promise(resolve=>{let done=false;const finish=(result?:string)=>{if(!done){done=true;clearTimeout(timer);resolve(result);}},timer=setTimeout(()=>finish(),1500);try{const request=indexedDB.open('artinfact-reader-runtime',1);request.onupgradeneeded=()=>request.result.createObjectStore('runtime');request.onerror=request.onblocked=()=>finish();request.onsuccess=()=>{const db=request.result,transaction=db.transaction('runtime',value===undefined?'readonly':'readwrite'),store=transaction.objectStore('runtime'),operation=value===undefined?store.get('current'):store.put({version:PLUGIN_VERSION,packed:value},'current');operation.onsuccess=()=>{if(value===undefined){const cached=operation.result;finish(cached?.version===PLUGIN_VERSION&&typeof cached.packed==='string'?cached.packed:undefined);}else finish(value);};transaction.oncomplete=transaction.onabort=()=>{db.close();finish();};};}catch{finish();}});
}
function createReaderShell(runtime:string){shellReady=false;frame?.remove();frame=document.createElement('iframe');frame.title='Zotero PDF 阅读器';frame.referrerPolicy='no-referrer';frameToken=crypto.randomUUID();frame.srcdoc=runtime.replaceAll('__CODEX_READER_SESSION__',frameToken);$('stage').append(frame);}
function initializeReader(){if(!shellReady||!buffer||!state||!documentInfo)return;lastReaderSettings=JSON.stringify(readerSettings());post('electron-reader:init',{type:'pdf',title:documentInfo.name,storageKey:documentInfo.id,workingDocument:{buf:buffer},annotations:[],primaryViewState:undefined,sidebarOpen:false,sidebarView:'pdfs',readOnly:true,settings:readerSettings(),embeddedPane:'main'});}
async function warmReader(){const runtime=await readerRuntime();if(!frame&&!documentInfo)createReaderShell(runtime);}
function startReaderExtras(){analysis.changed();void processorSettings.refresh();layout.changed();researchPanel.changed();citationActions.changed();}
function showQuote(value: PdfSelection) {
  selection = value; diagnostics.selection = value; diagnostics.context = '正在同步到 Codex…'; enable();
  const mine = generation; const doc = documentInfo!;
  $<HTMLButtonElement>('sync').disabled = !supportsContext();
  if (!supportsContext()) { diagnostics.context = '宿主未提供上下文接口'; notice('宿主未提供上下文接口，可用 Ctrl+Shift+O 复制选文到聊天。', true); return; }
  contextUsed = true;
  void (async () => {
    if (value.references?.citationNumbers.length || extractCitationNumbers(value.text).length) {
      try { value.references = (await call('pdf_selection_references', { documentId: doc.id, ...(doc.workspaceId ? { workspaceId: doc.workspaceId } : {}), text: value.text, citationTexts: value.references?.citationTexts ?? [], citationNumbers: value.references?.citationNumbers ?? [] }))._meta?.selectionReferences as SelectionReferences; }
      catch (error) { if (generation === mine && selection === value) notice(`选文仍会注入，参考文献补全失败：${errorMessage(error)}`, true); }
    }
    if (generation !== mine || selection !== value) return;
    await contextQueue.push(selectionContext(doc, value));
    if (generation === mine && selection === value) diagnostics.context = preview ? '预览已接收选文' : '已同步到 Codex';
    if (generation === mine && selection === value) notice(selectionLabel(value));
  })().catch(error => { if (generation === mine && selection === value) { diagnostics.context = `同步失败：${errorMessage(error)}`; notice(`${diagnostics.context}。Ctrl+Shift+O 可重试或复制选文。`, true); } });
}
async function clearContext() {
  if (contextUsed) { await contextQueue.push({ content: [], structuredContent: {} }); contextUsed = false; }
  selection = null; diagnostics.selection = null; diagnostics.context = ''; enable();
}
function save(patch: PdfPatch) {
  if (!documentInfo) return;
  const intent={ id: documentInfo.id, workspaceId: documentInfo.workspaceId, patch };
  intents.push(saveOutbox?saveOutbox.push(intent):structuredClone(intent));
  drain();
}
function drain() {
  saveTail = saveTail.catch(() => undefined).then(async () => {
    while (intents.length) {
      const item = intents[0];
      setStatus('正在保存批注与阅读位置…');
      const {annotations,...metadata}=item.patch;
      const patches:PdfPatch[]=[];let batch:NonNullable<PdfPatch['annotations']>=[],bytes=0;
      for(const annotation of annotations??[]){
        const size=new TextEncoder().encode(JSON.stringify(annotation)).byteLength;
        if(batch.length&&bytes+size>4*1024*1024){patches.push({annotations:batch});batch=[];bytes=0;}
        batch.push(annotation);bytes+=size;
      }
      if(batch.length)patches.push({annotations:batch});
      if(Object.keys(metadata).length||!patches.length)patches.push(metadata);
      // Updates merge by annotation ID, so replaying a partially saved intent is safe.
      for(const patch of patches)await call('pdf_state_update', { documentId: item.id, ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}), patch });
      intents.shift();if(item.key)saveOutbox?.ack(item.key);
    }
    setStatus('批注与阅读位置已保存到本机'); $('retry').hidden = true; $('backup-pending').hidden=true;
  });
  void saveTail.catch(error => { setStatus('保存失败 · 请重试'); $('retry').hidden = false; $('backup-pending').hidden=!intents.length;const cached=saveOutbox?.durable?'待保存修改已缓存，连接恢复后补存。':'修改仍在当前页面；请先备份，暂勿关闭。';notice(`批注尚未保存：${errorMessage(error)} ${cached}`, true); });
}
function flushView() { clearTimeout(viewTimer); if (viewPatch) { const patch = viewPatch; viewPatch = undefined; save(patch); } }
async function flush() {
  if (ready && frame) await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { flushWaiters.delete(requestId); reject(new Error('阅读器保存超时，文件未切换。请重试。')); }, 6000);
    flushWaiters.set(requestId, { resolve, reject, timer }); post('codex-reader:flush', { requestId });
  });
  flushView(); if (intents.length) drain(); await saveTail;
}
function restoreSaveOutbox(root:string) {
  if(outboxRoot===root)return;
  if(intents.length)throw new Error('还有待保存批注，请先重试保存或备份，再切换工作目录');
  outboxRoot=root;saveOutbox=undefined;
  try {saveOutbox=new PdfSaveOutbox(window.localStorage,root);intents.push(...saveOutbox.pending);}
  catch(error){notice('无法使用待保存批注缓存：'+errorMessage(error),true);}
}
async function openBytes(doc: PdfDocument, bytes: ArrayBuffer) {
  if (bytes.byteLength > 64 * 1024 * 1024 || !new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('请选择不超过 64 MB 的有效 PDF');
  await flush();
  await workspaceShell.flushNotes();
  await whiteboardPanel.flush();if(!pdfEvidence.preserving)pdfEvidence.clearReturn();researchPanel.hideGraph(pdfEvidence.preserving);whiteboardPanel.hideGraph(pdfEvidence.preserving);
  const pendingState=call('pdf_state_read',{documentId:doc.id,...(doc.workspaceId?{workspaceId:doc.workspaceId}:{})}).then(value=>({value:value._meta?.pdfState as PdfState|undefined,error:undefined}),error=>({value:undefined,error}));
  const runtime=await readerRuntime();
  await clearContext();
  loadWaiter?.reject(Error('PDF 已切换'));loadWaiter=undefined;generation++; ready = false;
  for (const waiter of readerWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('PDF 已切换')); } readerWaiters.clear();
  documentInfo=doc;buffer=bytes;state={version:1,revision:0,annotations:[]};stateRestored=false;const mine=generation;
  analysis.changed();
  document.title = doc.name; setStatus('正在加载完整阅读器…');
  $('empty').hidden=true;closeCommands();if(!frame?.isConnected||frame.dataset.documentId)createReaderShell(runtime);frame!.dataset.documentId=doc.id;
  clearTimeout(loadTimer);
  loading('正在绘制 PDF 页面…');
  const loaded=new Promise<void>((resolve,reject)=>{loadWaiter={resolve,reject};loadTimer=setTimeout(()=>reject(Error('PDF 初始化超时，请重新打开')),25000);});
  notice('');enable();initializeReader();
  // Annotation restoration cannot hold the first PDF page hostage.
  void loaded.then(async()=>{const result=await pendingState;if(mine!==generation)return;if(result.error)throw result.error;const value=result.value;if(!value||!Array.isArray(value.annotations))throw Error('无法读取批注存档');state=value;await requestReader('codex-reader:restore-state',{state:value});if(mine!==generation)return;stateRestored=true;startReaderExtras();}).catch(error=>{if(mine===generation&&ready)notice('PDF 原文可阅读，批注尚未恢复：'+errorMessage(error),true);});
  try{await loaded;}finally{clearTimeout(loadTimer);loadWaiter=undefined;}
}
async function openLocalFile(file: File) { await workspaceShell.importFiles([file]); }
async function consume(value: Config) {
  layout.stop();
  if(value.document){
    // Host tool results can outlive their MCP process, and each process has its own PDF handles.
    const workspaceId=(value.document as PdfDocument).workspaceId??value.workspaceId??workspaceShell.currentWorkspace();
    if(workspaceId){const fresh=(await call('pdf_workspace_document_open',{workspaceId,documentId:value.document.id}))._meta?.pdfReader as Config|undefined;if(!fresh?.document)throw Error('PDF 未能重新打开');value={...value,...fresh};}
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/.test(value.baseUrl)) throw new Error('无效的阅读器本机地址');
  config = { ...config, ...value };if(config.workspace)restoreSaveOutbox(config.workspace);
  if (value.markdown) { await workspaceShell.refresh(); await workspaceShell.open(value.markdown.workspaceId, 'md:' + value.markdown.name); }
  else if (value.document) {
    const url = new URL(value.document.url);
    if (!url.href.startsWith(`${value.baseUrl}documents/`)) throw new Error('PDF 地址不属于本机阅读器');
    if (!Number.isSafeInteger(value.document.size) || value.document.size < 1 || value.document.size > 64 * 1024 * 1024) throw new Error('PDF 文件大小无效');
    const bytes=new Uint8Array(value.document.size),length=768*1024;let cursor=0,received=0;
    const read=async()=>{while(cursor<bytes.length){const offset=cursor;cursor+=length;const chunk=(await call('pdf_document_read',{url:url.href,offset,length}))._meta?.pdfChunk;if(!chunk||chunk.offset!==offset||chunk.total!==bytes.length||typeof chunk.data!=='string'||chunk.data.length>1024*1024)throw Error('PDF 片段读取失败');const part=Uint8Array.from(atob(chunk.data),char=>char.charCodeAt(0));if(part.length!==Math.min(length,bytes.length-offset))throw Error('PDF 片段大小无效');bytes.set(part,offset);received+=part.length;loading('正在读取 PDF · '+Math.round(received/bytes.length*100)+'%');}};
    // Both packaged resources and PDF bytes use bounded concurrency over the host transport.
    const runtimeTask=readerRuntime();await Promise.all([read(),read(),read(),runtimeTask]);
    if (!(value.document as PdfDocument).workspaceId) { await workspaceShell.importFiles([new File([bytes], value.document.name, { type: 'application/pdf' })]); return; }
    await openBytes(value.document, bytes.buffer);
  } else if (value.hostFile) {
    if (!extensions.resources) throw new Error('当前宿主未提供文件资源读取接口，请使用“打开 PDF”选择文件');
    const result = await extensions.resources.read({ uri: value.hostFile.resourceUri, representation: 'blob' });
    const resource = result.contents.find(item => 'blob' in item);
    if (!resource || !('blob' in resource)) throw new Error('宿主没有返回 PDF 文件内容');
    if (resource.blob.length > 90 * 1024 * 1024) throw new Error('PDF 不能超过 64 MB');
    const bytes = Uint8Array.from(atob(resource.blob), char => char.charCodeAt(0));
    await openLocalFile(new File([bytes], value.hostFile.name, { type: /\.md$/i.test(value.hostFile.name) ? 'text/markdown' : 'application/pdf' }));
  }
}
let navigationView = false;
let readerNoteAiNode:string|undefined;
window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || !event.data || event.data.codexReaderToken !== frameToken || typeof event.data.type !== 'string') return;
  const payload = event.data.payload ?? {};
  switch (event.data.type) {
    case 'codex-reader:reference-action': case 'codex-reader:reference-stop': void citationActions.handle(event.data.type,payload);break;
    case 'codex-reader:note-ai': {
      const target=frame.contentWindow!,token=frameToken,scope=documentInfo?.workspaceId;
      void(async()=>{if(!scope||!ready||payload.nodeId!==readerNoteAiNode||typeof payload.id!=='string'||payload.id.length>100)throw Error('笔记 AI 请求不属于当前编辑区');let result;
        if(payload.operation==='tool'){if(!['whiteboard_note_ai_begin','whiteboard_note_ai_read','whiteboard_note_ai_cancel'].includes(payload.name))throw Error('不支持的笔记 AI 操作');result=await call(payload.name,{...payload.args,workspaceId:scope,...(payload.name==='whiteboard_note_ai_begin'?{nodeId:readerNoteAiNode}:{})});if(result.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text??'AI 请求失败');result=result.structuredContent;}
        else if(payload.operation==='send'){const task=await call('whiteboard_note_ai_read',{workspaceId:scope,requestId:payload.requestId,includeContext:false});if(task.isError||task.structuredContent?.nodeId!==readerNoteAiNode||task.structuredContent?.status!=='queued')throw Error('AI 请求已失效');result=await sendResearchMessage(noteAiPrompt(scope,payload.requestId));}
        else throw Error('AI 请求无效');target.postMessage({type:'codex-reader:note-ai-reply',codexReaderToken:token,payload:{id:payload.id,result}},'*');
      })().catch(error=>target.postMessage({type:'codex-reader:note-ai-reply',codexReaderToken:token,payload:{id:payload.id,error:String(error)}},'*'));break;
    }
    case 'codex-reader:translate-with-codex': {
      if (codexTranslationSending) break;
      const doc = documentInfo, target = translationPreferences.target;
      if (!doc || !ready) { notice('请先打开 PDF 并选中文字', true); break; }
      codexTranslationSending = true;
      run(async () => {
        try {
          const delivery = await sendSelectionTranslation(payload, doc, target, sendResearchMessage);
          notice(delivery.mode === 'sent' ? '选文已发送给 Codex，译文将在关联聊天中显示。' : delivery.mode === 'draft' ? '翻译提示词已放入聊天输入框，请点击发送。' : '请复制翻译提示词到关联聊天发送。');
        } finally { codexTranslationSending = false; }
      });
      break;
    }
    case 'electron-reader:lookup-selection-request': {
      const mine = generation, targetFrame = frame, token = frameToken;
      void replyToSelectionLookup(payload, async text => {
        const value = (await call('pdf_selection_translate', { text }))._meta?.selectionTranslation;
        if (!value) throw new Error('翻译服务未返回结果'); return value;
      }, () => generation === mine && frame === targetFrame && frameToken === token && translationPreferences.enabled,
      response => post('electron-reader:lookup-selection-response', response));
      break;
    }
    case 'electron-reader-ready': shellReady=true;initializeReader();break;
    case 'codex-reader:loaded': loadWaiter?.resolve();navigationView=false;ready=true;clearTimeout(loadTimer);setStatus('PDF 已打开');enable();workspaceShell.publishNavigation();break;
    case 'electron-reader-generate-ai-outline': run(() => researchPanel.generate('outline')); break;
    case 'electron-reader-generate-ai-insights': run(() => researchPanel.generate('insights')); break;
    case 'electron-reader-generate-ai-navigation': post('electron-reader:ensure-native-outline', {}); break;
    case 'electron-reader-clear-ai-outline': run(() => researchPanel.clear('outline')); break;
    case 'electron-reader-clear-ai-insights': run(() => researchPanel.clear('insights')); break;
    case 'codex-reader:analysis': case 'codex-reader:analysis-action': {
      const anchor = payload.anchor, rect = frame.getBoundingClientRect();
      if (anchor && [anchor.left,anchor.right,anchor.bottom].every(Number.isFinite)) rememberDropdownAnchor(document,{left:rect.left+anchor.left,right:rect.left+anchor.right,bottom:rect.top+anchor.bottom});
      if (payload.action === 'translation') showTranslationSettings();
      else if (payload.action === 'processor') processorSettings.show();
      else if (payload.action === 'convert') run(async () => {const doc=documentInfo;const continueParse=async()=>{if(documentInfo===doc)await analysis.convert();else if(doc?.workspaceId)await call('pdf_workspace_mineru_convert',{workspaceId:doc.workspaceId,documentId:doc.id});};if(await processorSettings.ready(continueParse))await continueParse();});
      else if (payload.action === 'layout') run(async () => {const doc=documentInfo;const continueParse=async()=>{if(documentInfo===doc){await layout.ensure();analysis.changed();}else if(doc?.workspaceId)await call('pdf_workspace_layout_start',{workspaceId:doc.workspaceId,documentId:doc.id,restart:false});};if(await layout.cached()||await processorSettings.ready(continueParse))await continueParse();});
      else { const doc = documentInfo; if (doc?.workspaceId) run(() => withOpening(() => workspaceShell.showConversion(doc.workspaceId!, doc.id))); }
      break;
    }
    case 'codex-reader:workspace-action':
      if(payload.action==='note-dirty'){if(typeof payload.id==='string')workspaceShell.stageNoteDraft(payload.id,{dirty:true});break;}
      if(payload.action==='note-draft'){if(typeof payload.id==='string')workspaceShell.stageNoteDraft(payload.id,payload);break;}
      if (!opening && typeof payload.action === 'string') run(() => withOpening(async () => {
        navigationView = payload.action === 'open' || payload.action === 'close';
        try { await workspaceShell.navigationAction(payload.action, payload.id, payload); } finally { navigationView = false; }
      }));
      break;
    case 'codex-reader:graph-back': run(()=>withOpening(async()=>{if(await pdfEvidence.back())workspaceShell.resumeGraph();}));break;
    case 'codex-reader:reply': { const waiter = readerWaiters.get(payload.requestId); if (waiter) { clearTimeout(waiter.timer); readerWaiters.delete(payload.requestId); if (payload.error) waiter.reject(new Error(String(payload.error))); else waiter.resolve(payload); } break; }
    case 'codex-reader:open-file': if (connected && !opening) $<HTMLInputElement>('pdf-input').click(); break;
    case 'codex-reader:settings': {
      const anchor = payload.anchor, rect = frame.getBoundingClientRect();
      if (anchor && [anchor.left,anchor.right,anchor.bottom].every(Number.isFinite)) rememberDropdownAnchor(document,{left:rect.left+anchor.left,right:rect.left+anchor.right,bottom:rect.top+anchor.bottom});
      showSettings(); break;
    }
    case 'codex-reader:commands': showCommands(); break;
    case 'codex-reader:appearance-change': {
      const value = normalizeAppearance(payload); if (!value) break;
      appearance = value; appearanceStyles(); lastReaderSettings = JSON.stringify(readerSettings());
      preferencesTail = preferencesTail.catch(() => undefined).then(async () => { await call('pdf_preferences_update', { appearance: value }); });
      void preferencesTail.catch(error => notice(`外观选择未保存：${errorMessage(error)}`, true));
      break;
    }
    case 'codex-reader:error': {const message=String(payload.message??'加载失败').slice(0,240);if(!ready)loadWaiter?.reject(Error(message));notice(`阅读器：${message}`,true);break;}
    case 'codex-reader:flushed': {
      const waiter = flushWaiters.get(payload.requestId);
      if (waiter) { clearTimeout(waiter.timer); flushWaiters.delete(payload.requestId); if (payload.error) waiter.reject(new Error(String(payload.error))); else waiter.resolve(); }
      break;
    }
    case 'electron-reader-selection-change': {
      const value = normalizeSelection(payload.selection);
      // A transient empty selection during focus transfer must not discard the quote.
      if (value && documentInfo && !opening && (payload.force === true || JSON.stringify(value) !== JSON.stringify(selection))) showQuote(value);
      break;
    }
    case 'electron-reader-save-annotations': if (Array.isArray(payload.annotations) && payload.annotations.length) save({ annotations: payload.annotations }); break;
    case 'electron-reader-delete-annotations': if (Array.isArray(payload.ids) && payload.ids.length) save({ deletedIds: payload.ids }); break;
    case 'electron-reader-change-view-state': if (stateRestored && payload.state && typeof payload.state === 'object') { viewPatch = { viewState: payload.state }; clearTimeout(viewTimer); viewTimer = setTimeout(flushView, 450); } break;
    case 'electron-reader-sidebar-state-change': if (stateRestored && ['annotations', 'outline', 'thumbnails', 'pdfs'].includes(payload.view)) save({ sidebar: { open: !!payload.open, view: payload.view } }); break;
    case 'electron-reader-open-external': run(async () => {
      const url = new URL(String(payload.url)); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持打开 HTTP/HTTPS 外部链接');
      if (preview) { window.open(url.href, '_blank', 'noopener,noreferrer'); return; }
      if (!app.getHostCapabilities()?.openLinks) throw new Error(`当前宿主不支持打开外部链接：${url.href}`);
      const result = await app.openLink({ url: url.href }); if (result.isError) throw new Error('Codex 未打开外部链接');
    }); break;
    case 'electron-reader-rotate-pages': case 'electron-reader-delete-pages': notice('当前插件保留原 PDF；页面内容编辑需在原项目或 PDF 编辑器中完成。', true); break;
    case 'electron-reader-add-to-workspace-note': case 'electron-reader-add-selection-to-workspace-note': if (documentInfo) { const doc = documentInfo; run(() => workspaceShell.appendAnnotations(doc, payload.annotations ?? [payload.annotation], payload.translatedText)); } break;
    case 'electron-reader-open-settings': showSettings(); break;
  }
});
$('choose').onclick = () => $<HTMLInputElement>('pdf-input').click();
$('choose-more').onclick = () => { closeCommands(); $<HTMLInputElement>('pdf-input').click(); };
$('path-toggle').onclick = () => { showCommands(); $('path').focus(); };
$('commands-close').onclick = closeCommands;
$('dismiss').onclick = () => notice('');
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'o') return;
  event.preventDefault();
  if (event.shiftKey) showCommands(); else if (connected && !opening) { closeCommands(); $<HTMLInputElement>('pdf-input').click(); }
}, true);
let openingTail: Promise<unknown> = Promise.resolve();
function withOpening(action: () => Promise<unknown>) { const task = openingTail.catch(() => undefined).then(async () => { opening = true; if (frame) frame.inert = true; enable(); try { return await action(); } finally { opening = false; if (frame) frame.inert = false; enable(); } }); openingTail = task; return task; }
async function suspendReader() {
  citationActions.dispose();
  await workspaceShell.flushNotes();
  await whiteboardPanel.flush();
  layout.stop();
  if(!pdfEvidence.preserving)pdfEvidence.clearReturn();researchPanel.hideGraph(pdfEvidence.preserving);whiteboardPanel.hideGraph(pdfEvidence.preserving);
  await flush(); await clearContext(); generation++; ready = false;stateRestored=false;shellReady=false; clearTimeout(loadTimer); frame?.remove(); frame = undefined; frameToken = ''; documentInfo = undefined; buffer = undefined; state = undefined;
  analysis.changed(); void processorSettings.refresh(); closeCommands(); enable();
}
async function openNativePage(pageId:string){
    if (preview) {
      const response = await fetch('/preview/page-open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: pagesAppUrl(pageId) }) });
      const result = await response.json(); if (!response.ok || result.isError) throw new Error('原生 Pages 链接预览记录失败');
      notice('预览已记录原生 Pages 链接；请在 App 中验证直接打开。'); return;
    }
    if (!app.getHostCapabilities()?.openLinks) throw new Error('当前宿主未提供原生链接打开接口');
    await openPageInHost(pageId, params => app.openLink(params, { timeout: 15000 }));
}
const whiteboardPanel=installWhiteboardPanel(root,{preprocess:id=>workspaceShell.showPreprocessing(id),generate:id=>workspaceShell.generateResearch(id),evidence:pdfEvidence.show,call,context:async value=>{contextUsed=true;await contextQueue.push(value);},send:sendResearchMessage,suspend:suspendReader,home:()=>workspaceShell.showHome(),open:(ws,id)=>workspaceShell.open(ws,id),openPage:openNativePage,managePage:(ws,name)=>workspaceShell.manageNote(ws,name),run});
const workspaceShell = installWorkspaceShell(root, { send: sendResearchMessage, navigation: value => {readerNoteAiNode=value.activeNote?.nodeId;post('codex-reader:workspace', value);}, call, suspend: suspendReader, choose: () => $<HTMLInputElement>('pdf-input').click(), settings: showSettings, notice,
  graph: (id,data,mode) => whiteboardPanel.showGraph(id,data,mode),
  openPage: openNativePage,
  noteDraft:async()=>ready?(await requestReader('codex-reader:note-flush',{})as{note?:import('./reader-workspace.js').ReaderNoteDraft}).note:undefined,
  run: action => run(() => withOpening(action)),
  open: async (workspaceId, documentId) => {
    root.append(readerLoading);loading('正在打开 PDF…');try{const value=(await call('pdf_workspace_document_open',{workspaceId,documentId}))._meta?.pdfReader;if(!value)throw Error('PDF 未能打开');await consume(value);}finally{readerLoading.hidden=true;}
  }
});
$('close-pdf').onclick = () => run(() => withOpening(() => workspaceShell.closeCurrent()));
function base64(bytes: Uint8Array) { let text = ''; for (let index = 0; index < bytes.length; index += 16384) text += String.fromCharCode(...bytes.subarray(index, index + 16384)); return btoa(text); }
async function download(name: string, bytes: Uint8Array, mimeType: string) {
  if (preview) { const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: mimeType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
  if (!app.getHostCapabilities()?.downloadFile) throw new Error('当前 Codex 宿主未提供文件下载接口；批注已保存在本机存档中。');
  const result = await app.downloadFile({ contents: [{ type: 'resource', resource: { uri: `file:///${encodeURIComponent(name)}`, mimeType, blob: base64(bytes) } }] });
  if (result.isError) throw new Error('Codex 未接受导出文件');
}
$('export-pdf').onclick = () => run(() => withOpening(async () => {
  if (!documentInfo || !buffer) return;
  if (!preview && !app.getHostCapabilities()?.downloadFile) throw new Error('当前宿主未提供文件下载接口');
  await flush(); const doc = documentInfo; const bytes = new Uint8Array(buffer);
  const token = (await call('pdf_export_start', { documentId: doc.id, size: bytes.length }))._meta?.exportToken;
  if (typeof token !== 'string') throw new Error('无法创建导出任务');
  try {
    notice('正在生成带批注的 PDF…');
    for (let offset = 0; offset < bytes.length; offset += 768 * 1024) await call('pdf_export_upload', { token, offset, data: base64(bytes.subarray(offset, offset + 768 * 1024)) });
    const size = (await call('pdf_export_finish', { token }))._meta?.size;
    if (!Number.isSafeInteger(size) || size < 1 || size > 128 * 1024 * 1024) throw new Error('导出 PDF 大小无效');
    const output = new Uint8Array(size); let offset = 0;
    while (offset < size) {
      const chunk = (await call('pdf_export_read', { token, offset, length: 768 * 1024 }))._meta?.exportChunk;
      if (!chunk || chunk.offset !== offset || chunk.total !== size || typeof chunk.data !== 'string' || chunk.data.length > 1024 * 1024) throw new Error('导出 PDF 片段无效');
      const part = Uint8Array.from(atob(chunk.data), char => char.charCodeAt(0)); if (!part.length || offset + part.length > size) throw new Error('导出 PDF 片段范围无效');
      output.set(part, offset); offset += part.length;
    }
    await download(`${doc.name.replace(/\.pdf$/i, '')}.annotated.pdf`, output, 'application/pdf'); notice('带批注 PDF 已导出。');
  } finally { await call('pdf_export_release', { token }).catch(() => undefined); }
}));
$<HTMLInputElement>('pdf-input').onchange = event => run(() => withOpening(async () => { const input = event.target as HTMLInputElement; const files = [...input.files ?? []]; if (files.length) await workspaceShell.importFiles(files); input.value = ''; }));
$('path-row').onsubmit = event => { event.preventDefault(); run(() => withOpening(async () => { await workspaceShell.importPath($<HTMLInputElement>('path').value.trim()); })); };
$('clear').onclick = () => run(clearContext);
$('sync').onclick = () => { if (selection) showQuote(selection); };
$('copy').onclick = () => run(async () => { if (selection && documentInfo) { await navigator.clipboard.writeText(selectionContext(documentInfo, selection).content[0].text); notice('引用已复制，可粘贴到 Codex 聊天。'); } });
$('backup-pending').onclick = () => run(async()=>{flushView();const bytes=new TextEncoder().encode(JSON.stringify({version:1,workspace:config?.workspace,pending:intents},null,2));await download('Artinfact-pending-annotations.json',bytes,'application/json');notice('待保存批注已备份；这不代表原存档已保存。');});
$('retry').onclick = () => { drain(); run(() => saveTail.then(() => notice('批注已保存。'))); };
$('export').onclick = () => run(() => withOpening(async () => {
  if (!documentInfo) return; await flush();
  const state = (await call('pdf_state_read', { documentId: documentInfo.id }))._meta?.pdfState;
  const text = JSON.stringify({ version: 1, documentId: documentInfo.id, name: documentInfo.name, state }, null, 2);
  const name = `${documentInfo.name.replace(/\.pdf$/i, '')}.annotations.json`;
  await download(name, new TextEncoder().encode(text), 'application/json');
}));
$('import').onclick = () => $<HTMLInputElement>('json-input').click();
$<HTMLInputElement>('json-input').onchange = event => run(() => withOpening(async () => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !documentInfo || !buffer) return;
  if (file.size > 24 * 1024 * 1024) throw new Error('批注备份不能超过 24 MB');
  const value = JSON.parse(await file.text());
  if (value.documentId !== documentInfo.id || !Array.isArray(value.state?.annotations)) throw new Error('批注备份与当前 PDF 内容不匹配');
  await flush(); save({ annotations: value.state.annotations }); await saveTail;
  const doc = documentInfo; const bytes = buffer; await openBytes(doc, bytes); input.value = ''; notice('批注已导入并保存。');
}));
function applyHost(context: ReturnType<App['getHostContext']>) {
  const mode = context?.theme ?? hostPalette.scheme;
  applyDocumentTheme(mode); document.documentElement.dataset.theme = mode;
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  hostPalette = readHostReaderPalette(document); appearanceStyles();
  const settings = readerSettings(); const signature = JSON.stringify(settings);
  if (signature !== lastReaderSettings) { lastReaderSettings = signature; post('electron-reader:apply-settings', settings); }
}
app.onhostcontextchanged = applyHost;
const refreshStaticChrome=captureStaticChrome(root);
app.ontoolresult = result => { const value = result._meta?.pdfReader as Config | undefined; if (value) { initialConfig = value; if (connected && preferencesReady && workspaceShell.currentWorkspace()) run(() => withOpening(async () => { await consume(value); if (documentInfo) await workspaceShell.opened(documentInfo); })); } else if (result.isError) notice('PDF 打开失败，请重新选择文件。', true); };
app.onteardown = async () => { citationActions.dispose(); analysis.stop(); layout.stop(); researchPanel.dispose(); await flush(); await preferencesTail; await translationPreferencesTail; return {}; };
try {
  if(!connected)throw bootstrapError??Error('Unable to connect to Artinfact');
  if(bootstrapError)notice('Unable to restore interface language: '+errorMessage(bootstrapError),true);
  localizeInitialMarkup();
  try { appearance = normalizeAppearance((await call('pdf_preferences_read', {}))._meta?.appearance); }
  catch (error) { notice(`未能恢复外观设置：${errorMessage(error)}`, true); }
  try { translationPreferences = (await call('pdf_translation_preferences_read', {}))._meta?.translationPreferences ?? { ...DEFAULT_TRANSLATION_PREFERENCES }; renderTranslationPreferences(); }
  catch (error) { translationPreferences.enabled = false; renderTranslationPreferences(); notice(`未能恢复翻译设置：${errorMessage(error)}`, true); }
  preferencesReady = true;
  applyHost(preview ? undefined : app.getHostContext());
  $<HTMLInputElement>('pdf-input').multiple = true;   const startup=(await call('pdf_open',{}))._meta?.pdfReader as Config|undefined;
  if(startup)config={...config,...startup};
  await workspaceShell.showHome();
  void warmReader().catch(error=>notice('阅读器资源准备失败：'+errorMessage(error),true));
  if(config?.workspace)restoreSaveOutbox(config.workspace);
  if(intents.length)drain();
  if (!preview) { const value = initialConfig ?? startup; if (value) await withOpening(async () => { await consume(value); if (documentInfo) await workspaceShell.opened(documentInfo); }); }
  if (!documentInfo) setStatus('请选择 PDF，或填写本机文件路径。'); enable();
} catch (error) { notice(`无法连接阅读器：${errorMessage(error)}`, true); enable(); }

