import {canvasTool,createCanvasToolbar,createCanvasSurrounds,type CanvasTool} from './canvas-toolbar.js';
import {graphDescription} from './graph-description.js';
import type {GraphNode} from '../shared/wiki-graph-view.js';
import {resizePanel} from './resizable-panel.js';
import {renderGraphSettings} from './graph-settings.js';
import type {GraphPreferences} from './graph-preferences.js';
export function describeGraphNode(node:GraphNode){
 const data=JSON.parse(document.getElementById('demo-evidence')?.textContent??'{}');
 const evidence=node.relativePath?(data.evidence?.[node.relativePath]||data.relations?.[node.relativePath]):undefined;
 const pages=JSON.parse(document.getElementById('graph-pages')?.textContent??'{}');
 const content=evidence?.statement??graphDescription(pages[node.relativePath??'']??'');if(!content)return;
 const section=document.createElement('section');section.className='source-description';const label=document.createElement('small');label.textContent=evidence?.quote?'原文释义 · '+evidence.paper+' · '+evidence.section:evidence?.kind??'来源笔记 · 内容摘录';
 const description=document.createElement('p');description.textContent=content;description.style.whiteSpace='pre-wrap';section.append(label,description);
 if(evidence?.quote){const quote=document.createElement('blockquote');quote.textContent=evidence.quote;section.append(quote);}
 document.querySelector('#detail h2')?.after(section);
}
export function createGraphCanvas(options:{switchMode:(mode:'editor'|'constellation')=>void;boardTool:(tool:CanvasTool)=>Promise<void>;zoom:(factor:number)=>void;scale:()=>number;fit:()=>void;clear:()=>void;preferences:GraphPreferences;changePreferences:(value:GraphPreferences)=>void}){
 const root=document.createElement('section');root.className='wb-editor graph-chrome';root.setAttribute('aria-label','图谱画布工具');
 const toolbar=document.createElement('div');toolbar.className='flow-editor-toolbar';root.append(toolbar);
 const catalog=document.querySelector<HTMLElement>('.catalog')!,detail=document.getElementById('detail')!;
 catalog.id='graph-library';detail.setAttribute('aria-label','节点详情');detail.setAttribute('role','complementary');
 const detailResize=resizePanel(detail,{host:root,container:document.documentElement,key:'artinfact-panel-width:graph',defaultWidth:360,label:'调整图谱详情侧栏宽度'});
 const notice=document.createElement('div');notice.className='graph-canvas-status';notice.setAttribute('role','status');root.append(notice);
 const error=(message:string)=>{notice.textContent=message.replace(/^Error: /,'');};
 const close=canvasTool('close','收起资料面板',()=>{catalog.classList.remove('open');sync();},error);catalog.querySelector('.catalog-heading')!.append(close);
 const filters=document.querySelector<HTMLElement>('.filter-bar')!;catalog.querySelector('.search')!.after(filters);filters.querySelector<HTMLElement>('#browse')!.hidden=true;
 const boardAction=(tool:CanvasTool)=>async()=>{catalog.classList.remove('open');more.hidden=true;options.switchMode('editor');await options.boardTool(tool);};
 const more=document.createElement('div');more.className='wb-more-menu';more.hidden=true;more.setAttribute('aria-label','更多图谱操作');
 const menuItem=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{more.hidden=true;controls.more.setAttribute('aria-expanded','false');action();};return b;};
 root.append(more);
 const controls=createCanvasToolbar(toolbar,{insert:boardAction('insert'),library:boardAction('library'),note:boardAction('note'),board:boardAction('board'),link:boardAction('link'),agent:boardAction('agent'),undo:boardAction('undo'),redo:boardAction('redo'),more:()=>{more.hidden=!more.hidden;controls.more.setAttribute('aria-expanded',String(!more.hidden));}},error);
 controls.library.setAttribute('aria-controls','wb-library');
 controls.undo.disabled=true;controls.redo.disabled=true;
 controls.more.hidden=true;
 // Edits belong to the active MCP whiteboard. Keep the same tools and hand the action to that view.
 for(const tool of ['note','link','agent','undo','redo'] as const)controls[tool].dataset.tip+=' · 在白板中操作';
 const zoomLabel=document.createElement('button');zoomLabel.type='button';zoomLabel.className='flow-zoom-label';zoomLabel.setAttribute('aria-label','重置为100%');zoomLabel.onclick=()=>options.zoom(1/options.scale());
 const surrounds=createCanvasSurrounds(root,{mode:'constellation',switchMode:options.switchMode,theme:()=>document.getElementById('theme')!.click(),zoomLabel,zoomOut:()=>options.zoom(1/1.15),zoomIn:()=>options.zoom(1.15),fit:options.fit,onError:error,renderGraphSettings:menu=>renderGraphSettings(menu,options.preferences,options.changePreferences)});document.body.append(root);
 document.addEventListener('artinfact:open-graph-settings',()=>{if(!root.hidden)surrounds.menu.showPopover();});
 function sync(){controls.library.setAttribute('aria-expanded',String(catalog.classList.contains('open')));}
 new MutationObserver(sync).observe(catalog,{attributes:true,attributeFilter:['class']});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!root.hidden&&!document.querySelector('dialog[open]')){if(surrounds.menu.matches(':popover-open')){event.preventDefault();surrounds.closeSettings();return;}catalog.classList.remove('open');more.hidden=true;sync();options.clear();}});
 sync();return{syncZoom(){const value=Math.round(options.scale()*100)+'%';if(zoomLabel.textContent!==value)zoomLabel.textContent=value;},setVisible(visible:boolean){if(!visible){detailResize.cancel();surrounds.closeSettings();}root.hidden=!visible;if(!visible){catalog.classList.remove('open');more.hidden=true;sync();}},root};
}
