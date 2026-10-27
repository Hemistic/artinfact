import {showDropdown} from './dropdown.js';
import {setControlIcon} from './icons.js';
import {preparePdfResearch,preprocessingData,cancelPdfPreprocessing} from '../shared/pdf-research-request.js';
import {graphProcessingState} from '../shared/workspace-menu.js';
import type {ResearchDelivery} from '../shared/research-delivery.js';
import './pdf-preprocessing.css';
import {articleResearchPresets,referenceResearchPresets,researchUiForm,installResearchUiStyles} from '../shared/research-ui.js';
import {runWorkbench,runPdfAi,referenceChoices,runReference,type ResearchBridge} from '../shared/research-runner.js';

type Hooks={call(name:string,args:Record<string,unknown>):Promise<any>;send(text:string):Promise<ResearchDelivery>;notice(message:string,error?:boolean):void};
export function installPdfPreprocessing(root:HTMLElement,hooks:Hooks){
 const dialog=document.createElement('dialog');dialog.className='pdf-preprocessing-menu';dialog.setAttribute('aria-label','基础资料与按需 AI');
 dialog.innerHTML='<div class="dialog-title"><strong>卡片数据预处理</strong><button data-action="close" aria-label="关闭资料处理"></button></div><p role="status">正在读取处理状态…</p><details class="preprocess-papers"><summary>选择论文 <small class="preprocess-selection-count"></small></summary><div class="preprocess-documents"></div></details><hr><strong class="preprocess-level">自动化资料准备</strong><button data-action="preprocess" class="processing-menu-action" aria-expanded="false">PDF 基础卡片</button><section class="preprocess-options" hidden><p class="preprocess-help">原文、图表、图注、脚注、公式和参考文献由主程序准备，不需要 AI 解释。</p><label class="preprocess-force"><input type="checkbox">更新基础资料（保留手写与 AI 内容）</label><button data-action="start" class="processing-menu-action">生成基础卡片</button></section><hr><strong class="preprocess-level">按需 Agent 研读</strong><details class="preprocess-ai"><summary>AI 大纲与洞察批注</summary><button data-action="outline-ui" class="processing-menu-action">AI 大纲</button><p class="preprocess-help">只更新阅读目录，不生成卡片。</p><button data-action="insights-ui" class="processing-menu-action">AI 洞察与批注</button><p class="preprocess-help">成功后成为 PDF 下的 AI 洞察卡片。</p></details><details class="preprocess-ai" data-research="article"><summary>图表预处理 · 文章逻辑模板</summary><div class="preprocess-research-body"></div></details><details class="preprocess-ai" data-research="references"><summary>参考文献总结</summary><div class="preprocess-research-body"></div><small class="preprocess-help">第三级深度探索由你在卡片中发起。</small></details><details class="preprocess-ai"><summary>知识图谱</summary><button data-action="graph" class="processing-menu-action">生成知识图谱</button></details><button data-action="cancel" class="processing-menu-action" hidden>停止任务</button><hr><button data-action="refresh" class="processing-menu-action">刷新进度</button>';
 root.append(dialog);
 const button=(action:string)=>dialog.querySelector<HTMLButtonElement>('[data-action="'+action+'"]')!;
 for(const [action,icon]of [['close','close'],['graph','graph'],['preprocess','refresh'],['start','refresh'],['refresh','refresh'],['cancel','close']]as const)setControlIcon(button(action),icon,action!=='close');
 const status=dialog.querySelector<HTMLElement>('[role=status]')!,options=dialog.querySelector<HTMLElement>('.preprocess-options')!,selection=new Set<string>();
 let id='',data:any,hasGraph=false,busy=false,loading=false,refreshing=false,stopping=false,handingOff=false,operation:Promise<void>|undefined,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,epoch=0,anchorTop=8;
 installResearchUiStyles(document);
 const hideAiPreview=()=>{for(const host of dialog.querySelectorAll<HTMLElement>('[data-ai-preview]'))host.hidden=true;};
 const selectedPapers=()=> (data?.documents??[]).filter((doc:any)=>selection.has(doc.id)).map((doc:any)=>doc.name as string);
 const bridgeFor=(workspaceId:string):ResearchBridge=>({workspaceId,call:hooks.call,send:hooks.send,changed:async()=>{if(id===workspaceId&&dialog.open)await poll();}});
 for(const [action,title,presets]of [
  ['outline-ui','AI 大纲',[{id:'outline',label:'梳理章节大纲',instruction:'按原文章节解释研究问题、方法、实验和结论的结构，保留原有目录直到 AI 大纲成功生成。',output:'PDF 目录 · 不生成卡片'}]],
  ['insights-ui','AI 洞察与批注',[{id:'insights',label:'提炼洞察与原文批注',instruction:'阅读全文，提炼创新点、关键证据和局限，保留可定位的原句并生成研读卡片。',output:'PDF 批注 · ＋资料库的 AI 洞察'}]]
 ] as const){const host=document.createElement('div');host.className='preprocess-research-body';host.dataset.aiPreview=action;host.hidden=true;button(action).after(host);button(action).onclick=()=>{const opening=host.hidden;hideAiPreview();if(opening){const bridge=bridgeFor(id),documentIds=[...selection];host.replaceChildren(researchUiForm(document,{key:id+':'+action+':'+documentIds.join(','),title,scope:selectedPapers(),presets:[...presets],submit:input=>runPdfAi(bridge,documentIds,action==='outline-ui'?'outline':'insights',input)}));host.hidden=false;}fitMenu();};}
 for(const detail of dialog.querySelectorAll<HTMLDetailsElement>('[data-research]'))detail.addEventListener('toggle',()=>{if(!detail.open)return;const reference=detail.dataset.research==='references',host=detail.querySelector<HTMLElement>('.preprocess-research-body')!,bridge=bridgeFor(id),documentIds=[...selection],mine=epoch;
  if(!reference){host.replaceChildren(researchUiForm(document,{key:id+':article:'+documentIds.join(','),title:'文章逻辑模板',scope:selectedPapers(),presets:articleResearchPresets,submit:input=>runWorkbench(bridge,{kind:'article',documentIds},input)}));fitMenu();return;}
  host.textContent='正在读取文末参考文献…';void referenceChoices(bridge,documentIds).then(choices=>{if(mine!==epoch||!detail.open)return;host.replaceChildren();if(!choices.length){host.textContent='没有可定位的参考文献，请先完成 MinerU 标准解析。';fitMenu();return;}
   const selected=new Set<string>(),list=document.createElement('div'),form=document.createElement('div');list.style.cssText='max-height:132px;overflow:auto;margin:6px 0';const refresh=()=>{const items=choices.filter(c=>selected.has(c.referenceId));form.replaceChildren(researchUiForm(document,{key:bridge.workspaceId+':references:'+items.map(c=>c.referenceId).join(','),title:'参考文献总结',scope:items.map(c=>c.title),presets:referenceResearchPresets,download:true,submit:input=>runReference(bridge,items,input)}));fitMenu();};
   for(const choice of choices){const label=document.createElement('label'),check=document.createElement('input'),name=document.createElement('span');check.type='checkbox';name.textContent=choice.title;label.style.cssText='display:flex;align-items:flex-start;gap:6px;font-size:12px;margin:5px 0';check.onchange=()=>{check.checked?selected.add(choice.referenceId):selected.delete(choice.referenceId);refresh();};label.append(check,name);list.append(label);}host.append(list,form);refresh();
  }).catch(error=>{if(mine===epoch)host.textContent=String(error);});fitMenu();});
 dialog.querySelectorAll('details').forEach(detail=>detail.addEventListener('toggle',fitMenu));
 const report=(error:unknown)=>{status.textContent=String(error).replace(/^Error: /,'');hooks.notice(status.textContent,true);};
 function fitMenu(){
  if(!dialog.open)return;
  // The native Codex composer floats over the bottom of the app viewport.
  const bottom=Math.max(8,dialog.ownerDocument.defaultView!.innerHeight-96),height=Math.min(520,Math.max(0,bottom-8),dialog.scrollHeight+2);
  const top=Math.max(8,Math.min(anchorTop,bottom-height));
  Object.assign(dialog.style,{top:`${top}px`,maxHeight:`${Math.max(0,Math.min(520,bottom-top))}px`});
 }
 function showMenu(){showDropdown(dialog);anchorTop=parseFloat(dialog.style.top)||8;fitMenu();}
 function render(){
  const list=dialog.querySelector('.preprocess-documents')!,scrollTop=list.scrollTop;list.replaceChildren();
  for(const doc of data?.documents??[]){const row=document.createElement('label');row.className='preprocess-document';const check=document.createElement('input');check.type='checkbox';check.dataset.documentId=doc.id;check.checked=selection.has(doc.id);check.disabled=busy||stopping||loading;
   check.disabled||=graphProcessingState(data??{},hasGraph).running;check.onchange=()=>{check.checked?selection.add(doc.id):selection.delete(doc.id);sync();for(const detail of dialog.querySelectorAll<HTMLDetailsElement>('[data-research][open]')){detail.open=false;}hideAiPreview();};
   const body=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=doc.name;detail.textContent=doc.ready?doc.completed+'/'+doc.total+' 张基础卡片 · 已有 AI 说明 '+(doc.aiCompleted??0)+' 项':'尚未解析，开始后使用本机 MinerU';body.append(name,detail);row.append(check,body);list.append(row);
  }
  list.scrollTop=scrollTop;button('graph').textContent=graphProcessingState(data??{},hasGraph).graphLabel;setControlIcon(button('graph'),'graph');sync();fitMenu();
 }
 function sync(){dialog.querySelector('.preprocess-selection-count')!.textContent=selection.size+' 篇';const state=graphProcessingState(data??{},hasGraph),locked=busy||stopping||loading;button('start').disabled=locked||state.running||!selection.size;button('graph').disabled=locked||state.running||!selection.size;button('cancel').hidden=!busy&&!stopping&&!state.running;button('cancel').disabled=stopping||handingOff;button('cancel').textContent=stopping?'正在停止…':'停止任务';button('cancel').title='停止后续 AI 处理；已开始的 MinerU 解析继续后台完成';setControlIcon(button('cancel'),'close');button('refresh').disabled=locked;dialog.querySelector<HTMLInputElement>('.preprocess-force input')!.disabled=locked||state.running;}
 const activeTaskId=()=>['queued','running'].includes(data?.task?.status)?data.task.id:[...(data?.tasks??[])].reverse().find((t:any)=>['queued','running'].includes(t.status))?.id;
 function schedule(){clearTimeout(timer);if(dialog.open&&!busy&&!stopping&&!loading&&!refreshing)timer=setTimeout(()=>void poll(),4000);}
 async function load(scope:string){const [preprocessed,graph]=await Promise.all([hooks.call('whiteboard_pdf_preprocess_read',{workspaceId:scope}),hooks.call('pdf_workspace_graph_status',{workspaceId:scope})]);if(graph.isError)preprocessingData(graph);return{data:preprocessingData(preprocessed),hasGraph:!!graph._meta?.research?.generatedAt};}
 async function poll(){clearTimeout(timer);if(!id||!dialog.open||busy||stopping||loading||refreshing)return;const mine=epoch,scope=id;refreshing=true;
  try{const next=await load(scope);if(mine!==epoch||!dialog.open||busy||stopping)return;const changed=JSON.stringify([data,hasGraph])!==JSON.stringify([next.data,next.hasGraph]);data=next.data;hasGraph=next.hasGraph;if(changed)render();status.textContent=graphProcessingState(data,hasGraph).status;const last=data.tasks?.at(-1);if(last?.status==='failed')status.textContent+=' · '+last.message;}
  catch(error){if(mine===epoch&&dialog.open)report(error);}finally{if(mine===epoch){refreshing=false;schedule();}}
 }
 function revealOptions(){options.hidden=!options.hidden;button('preprocess').setAttribute('aria-expanded',String(!options.hidden));fitMenu();}
 async function show(workspaceId:string,select=false){
  if(busy||stopping){if(id!==workspaceId)throw Error('当前工作区正在准备资料，请稍后切换');showMenu();return false;}
  id=workspaceId;const mine=++epoch;clearTimeout(timer);loading=true;refreshing=false;selection.clear();data=undefined;hasGraph=false;hideAiPreview();for(const detail of dialog.querySelectorAll<HTMLDetailsElement>('[data-research]')){detail.open=false;detail.querySelector('.preprocess-research-body')!.replaceChildren();}dialog.querySelector<HTMLInputElement>('.preprocess-force input')!.checked=false;render();options.hidden=!select;button('preprocess').setAttribute('aria-expanded',String(select));status.textContent='正在读取处理状态…';showMenu();
  try{const next=await load(workspaceId);if(mine!==epoch)return false;data=next.data;hasGraph=next.hasGraph;for(const doc of data.documents)selection.add(doc.id);status.textContent=data.documents.length?graphProcessingState(data,hasGraph).status:'请先添加 PDF';return true;}
  catch(error){if(mine===epoch)throw error;return false;}finally{if(mine===epoch){loading=false;render();schedule();}}
 }
 function start(graph:boolean){
  if(busy||stopping||loading||!id||!selection.size||graphProcessingState(data??{},hasGraph).running)return;const scope=id,ids=[...selection];busy=true;controller=new AbortController();const signal=controller.signal;clearTimeout(timer);render();
  operation=(async()=>{try{const request=await preparePdfResearch(hooks.call,scope,{documentIds:ids,graph,force:dialog.querySelector<HTMLInputElement>('.preprocess-force input')!.checked,signal,progress:message=>{if(!stopping)status.textContent=message;}});data=request.data;
   if(signal.aborted)return;
   if(request.prompt){handingOff=true;status.textContent='正在交给 Agent…';sync();const delivery=await hooks.send(request.prompt);status.textContent=delivery.mode==='sent'?(graph?'已交给 Agent：按需洞察与图谱':'已交给 Agent 处理主动请求'):delivery.mode==='draft'?'任务已放入聊天输入框，请发送':'任务已准备，请复制到当前聊天执行';}
   else status.textContent='基础卡片已自动准备，未启动 AI；在＋菜单中按需添加。';hooks.notice(status.textContent);
  }catch(error){if((error as Error).name==='AbortError'){if(!stopping){status.textContent=(error as Error).message;hooks.notice(status.textContent);}}else report(error);}finally{busy=false;handingOff=false;controller=undefined;operation=undefined;render();schedule();}})();return operation;
 }
 button('close').onclick=()=>dialog.close();dialog.onclose=()=>{if(dialog.open)return;hideAiPreview();clearTimeout(timer);++epoch;loading=false;refreshing=false;sync();};button('preprocess').onclick=revealOptions;button('start').onclick=()=>void start(false);button('graph').onclick=()=>void start(true);button('refresh').onclick=()=>void poll();
 button('cancel').onclick=()=>{if(stopping||handingOff||(!busy&&!graphProcessingState(data??{},hasGraph).running))return;stopping=true;const scope=id,pending=operation,target=activeTaskId();controller?.abort();clearTimeout(timer);status.textContent='正在停止后续 AI 处理…';render();void(async()=>{await pending;const taskId=target??(['queued','running'].includes(data?.task?.status)?data.task.id:undefined),next=taskId?await cancelPdfPreprocessing(hooks.call,scope,taskId):preprocessingData(await hooks.call('whiteboard_pdf_preprocess_read',{workspaceId:scope}));if(scope!==id)return;data=next;status.textContent='已停止后续 AI 处理；已保存的资料保留。';})().catch(report).finally(()=>{stopping=false;render();schedule();});};
 return{show:async(workspaceId:string,select=false)=>{await show(workspaceId,select);},async generate(workspaceId:string){if(await show(workspaceId)&&id===workspaceId)await start(true);}};
}

