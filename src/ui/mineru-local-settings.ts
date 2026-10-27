import { showDropdown } from './dropdown.js';
import { setControlIcon } from './icons.js';
import {processorBusy,type LocalProcessorStatus as Processor} from '../shared/local-processor.js';
export function installLocalMineruSettings(root: HTMLElement, hooks: { call(name: string, args: Record<string, unknown>): Promise<any>;progress?(value:Processor):void }) {
  const dialog = document.createElement('dialog'); dialog.className = 'workspace-conversion-dialog'; dialog.setAttribute('aria-label', '本机 MinerU 设置');
  dialog.innerHTML = '<div class="dialog-title"><strong>本机 MinerU</strong><button data-action="close" aria-label="关闭"></button></div><p data-id="intro"></p><form><label>安装目录（默认在当前工作目录下）<div class="path-row"><input name="root" autocomplete="off"><button type="submit">保存路径</button></div></label></form><label>模型下载源<select name="source"><option value="" disabled selected>请选择下载源</option><option value="modelscope">中国源（ModelScope）</option><option value="huggingface">美国／国际源（Hugging Face）</option></select></label><p class="conversion-help">点击一次即可自动下载、安装、部署并测试，无需手动运行脚本。首次模型下载约 2 GB；安装工具与 Python 使用官方来源。插件仅附安装脚本，不包含环境和模型。使用官方基础依赖并自动加速；Apple Silicon 会自动安装官方要求的 Torch 依赖。</p><div class="command-actions"><button data-action="install" disabled>下载并部署</button><button data-action="refresh">检查状态</button></div><p role="status"></p><details><summary>安装详情</summary><p class="current-file" data-id="log"></p><pre data-id="detail" style="max-height:160px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre></details>';
  root.append(dialog); const button = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  for (const [action, icon] of [['close', 'close'], ['install', 'download'], ['refresh', 'refresh']] as const) setControlIcon(button(action), icon, action !== 'close');
  const input = dialog.querySelector<HTMLInputElement>('input')!, label = dialog.querySelector<HTMLElement>('[role=status]')!, log = dialog.querySelector<HTMLElement>('[data-id=log]')!;
  const source = dialog.querySelector<HTMLSelectElement>('select')!;
  const sourceChosen = () => ['modelscope','huggingface'].includes(source.value);
  let timer: ReturnType<typeof setTimeout> | undefined, editing = false, busy = false,mutating=false,readRevision=0,lastValue:Processor|undefined,pending:(()=>Promise<void>)|undefined;
  const messages: Record<string, string> = { starting: '正在启动自动下载与部署…', installing: '正在自动安装基础环境与依赖…', downloading: '正在下载 ONNX 和 llama.cpp 模型…', testing: '正在实际解析 PDF，校验 Markdown 和 JSON…', completed: '部署与测试成功，可以返回阅读器解析布局。', failed: '部署失败', 'dependencies-only': '依赖已安装，还需下载模型并完成 PDF 测试。' };
  function controls() {
    const locked=busy||mutating;
    input.disabled=!!lastValue?.environmentOverride||locked;
    dialog.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled=!!lastValue?.environmentOverride||locked;
    button('install').disabled=locked||!sourceChosen();source.disabled=locked;
  }
  function render(value: Processor) {
    clearTimeout(timer);lastValue=value;hooks.progress?.(value);const phase = value.progress?.phase, active = processorBusy(value); busy = active;
    if (!editing) input.value = value.root;controls();
    dialog.querySelector<HTMLElement>('strong')!.textContent = value.installed ? '本机 MinerU 设置' : '需要下载 MinerU';
    dialog.querySelector<HTMLElement>('[data-id=intro]')!.textContent = value.installed ? '处理器已部署。解析在本机生成 Markdown、结构 JSON 和图表坐标，PDF 不上传云端。' : '布局解析需要部署 MinerU。选择下载源，点击“下载并部署”，插件会自动完成全部步骤；无需另行打开安装脚本。';
    button('install').textContent = value.installed ? '重新部署并测试' : phase==='failed' ? '重试部署' : '下载并部署'; setControlIcon(button('install'),'download');
    label.textContent = phase ? messages[phase] ?? value.progress!.label : value.installed ? '本机标准处理器已就绪。' : value.error ?? '尚未安装';
    if (phase === 'failed') label.textContent += '：' + value.progress!.label;
    log.textContent = value.progress?.log ? `安装日志：${value.progress.log}` : '';
    dialog.querySelector<HTMLElement>('[data-id=detail]')!.textContent = value.detail ?? '';
    if(active)label.textContent+=' · 可关闭窗口，继续在后台完成。';
    if(active||dialog.open){timer=setTimeout(()=>void refresh(),2000);timer.unref?.();}
    if(value.installed&&!active&&!mutating&&pending){const action=pending;pending=undefined;void action().catch(e=>{label.textContent='后台布局解析启动失败：'+String(e);});}
  }
  async function refresh() {
    if(mutating)return;
    clearTimeout(timer);const mine=++readRevision;
    try {const value=(await hooks.call('pdf_processor_read', {}))._meta.processor;if(mine===readRevision&&!mutating)render(value);}
    catch (e) {if(mine!==readRevision||mutating)return;label.textContent=String(e);if(busy||dialog.open){timer=setTimeout(()=>void refresh(),2000);timer.unref?.();}}
  }
  async function change(action:()=>Promise<Processor>,message:string) {
    if(busy||mutating)return;
    mutating=true;readRevision++;clearTimeout(timer);controls();label.textContent=message;
    try {const value=await action();mutating=false;render(value);}
    catch(e){mutating=false;controls();label.textContent=String(e);if(busy||dialog.open){timer=setTimeout(()=>void refresh(),2000);timer.unref?.();}}
  }
  input.oninput = () => { editing = true; };
  dialog.querySelector('form')!.onsubmit = event => {event.preventDefault();const path=input.value.trim();void change(async()=>{const value=(await hooks.call('pdf_processor_update',{root:path}))._meta.processor;editing=false;return value;},'正在保存处理器目录…');};
  source.onchange = controls;
  button('install').onclick = () => {if(!sourceChosen())return;const modelSource=source.value,path=input.value.trim();void change(async()=>{if(editing){await hooks.call('pdf_processor_update',{root:path});editing=false;}return (await hooks.call('pdf_processor_install',{modelSource}))._meta.processor;},'正在启动自动部署…');};
  button('refresh').onclick = () => void refresh(); button('close').onclick = () => dialog.close(); dialog.onclose = () => {if(!busy&&!mutating){clearTimeout(timer);pending=undefined;}};
  return { refresh,show() { if (!dialog.open) showDropdown(dialog); void refresh(); }, async ready(onReady?:()=>Promise<void>) {
    if(mutating){pending=onReady;if(!dialog.open)showDropdown(dialog);return false;}
    const mine=++readRevision,value=(await hooks.call('pdf_processor_read', {}))._meta.processor as Processor;
    if(mine!==readRevision||mutating){if(onReady){pending=onReady;if(lastValue&&!mutating)render(lastValue);}return false;}
    if(!value.installed||processorBusy(value)){pending=onReady;if(!dialog.open)showDropdown(dialog);render(value);return false;}
    lastValue=value;busy=false;controls();hooks.progress?.(value);return true;
  } };
}
