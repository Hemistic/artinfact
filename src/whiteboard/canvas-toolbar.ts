import {canvasIcon} from './canvas-icons.js';
import {canvasControlHeight} from './canvas-control-size.js';
import {bindControlTooltip} from '../shared/control-tooltip.js';
import {createWorkspaceViewSwitch} from '../shared/workspace-view-switch.js';
import {returnWorkspaceHome} from './whiteboard-client.js';
export type CanvasTool='insert'|'library'|'note'|'board'|'link'|'agent'|'tools'|'undo'|'redo'|'more'|'export';
export const canvasTools:ReadonlyArray<{id:CanvasTool;label:string}>= [
 {id:'insert',label:'添加资料'},
 {id:'library',label:'白板'},{id:'note',label:'添加笔记'},
 {id:'link',label:'建立连接'},{id:'agent',label:'模板与 Agent 分析'},
 {id:'tools',label:'分区背景'},{id:'undo',label:'撤销'},{id:'redo',label:'重做'},{id:'export',label:'导出'},{id:'more',label:'更多操作'},
];
export function canvasTool(icon:Parameters<typeof canvasIcon>[0],label:string,action:()=>void|Promise<void>,onError:(message:string)=>void,cls=''){
 const control=document.createElement('button');control.type='button';control.className='wb-tool '+cls;
 control.setAttribute('aria-label',label);bindControlTooltip(control);
 let pending=false;control.append(canvasIcon(icon));control.onclick=()=>{if(pending||control.disabled)return;pending=true;control.setAttribute('aria-busy','true');void Promise.resolve().then(action).catch(e=>onError(String(e))).finally(()=>{pending=false;control.removeAttribute('aria-busy');});};return control;
}
export function canvasDivider(){const element=document.createElement('span');element.className='wb-tool-divider';return element;}
export function createCanvasToolbar(toolbar:HTMLElement,actions:Record<Exclude<CanvasTool,'tools'|'export'>,()=>void|Promise<void>>&{tools?:()=>void|Promise<void>;export?:()=>void|Promise<void>},onError:(message:string)=>void){
 toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','画布固定工具栏');toolbar.dataset.fixed='true';
 const controls={} as Record<CanvasTool,HTMLButtonElement>;
 for(const {id,label}of canvasTools){const action=actions[id];if(!action)continue;const control=canvasTool(id==='insert'?'plus':id,label,action,onError);if(id==='library'||id==='export'){const text=document.createElement('span');text.textContent=label;control.append(text);control.classList.add('wb-tool-labelled');}controls[id]=control;if(id==='note'||id==='agent')continue;if(id==='undo')toolbar.append(canvasDivider());toolbar.append(control);}
 return controls;
}
export function createCanvasSurrounds(root:HTMLElement,options:{mode:'editor'|'constellation';switchMode:(mode:'editor'|'constellation')=>void|Promise<void>;theme:()=>void;zoomLabel:HTMLButtonElement;zoomOut:()=>void;zoomIn:()=>void;fit:()=>void;onError:(message:string)=>void;renderGraphSettings?:(menu:HTMLElement)=>void}){
 root.style.setProperty('--wb-control-height',canvasControlHeight+'px');
 const make=(icon:Parameters<typeof canvasIcon>[0],label:string,action:()=>void)=>canvasTool(icon,label,action,options.onError);
 const menu=document.createElement('div');menu.className='wb-canvas-settings';menu.setAttribute('popover','auto');menu.id='canvas-settings-'+options.mode;menu.setAttribute('aria-label','图谱设置');
 const closeSettings=()=>{if(menu.matches(':popover-open'))menu.hidePopover();};
 const modes=createWorkspaceViewSwitch({mode:options.mode,select:mode=>{closeSettings();return options.switchMode(mode);},onError:options.onError});modes.classList.add('wb-canvas-modes');
 modes.append(canvasTool('home','返回工作区首页',async()=>{closeSettings();await returnWorkspaceHome();},options.onError));
 const theme=make('theme','切换明暗主题',options.theme);theme.classList.add('wb-floating-theme');
 const settings=make('settings','设置菜单',()=>menu.togglePopover());settings.setAttribute('aria-controls',menu.id);settings.setAttribute('aria-expanded','false');menu.addEventListener('toggle',()=>settings.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
 const heading=document.createElement('strong');heading.textContent='图谱设置';menu.append(heading);
 if(options.renderGraphSettings)options.renderGraphSettings(menu);
 const actions=options.renderGraphSettings?[]:[{label:'打开图谱设置',run:async()=>{await options.switchMode('constellation');document.dispatchEvent(new Event('artinfact:open-graph-settings'));}}];
 for(const action of actions){const item=document.createElement('button');item.type='button';item.textContent=action.label;item.onclick=()=>{closeSettings();void Promise.resolve().then(action.run).catch(e=>options.onError(String(e)));};menu.append(item);}
 const topActions=document.createElement('div');topActions.className='wb-canvas-top-actions';topActions.setAttribute('role','group');topActions.setAttribute('aria-label','画布设置与外观');topActions.append(settings,theme);
 const zoom=document.createElement('div');zoom.className='flow-zoom-tools wb-floating-zoom';zoom.setAttribute('role','toolbar');zoom.setAttribute('aria-label','画布缩放');
 zoom.append(make('minus','缩小画布',options.zoomOut),options.zoomLabel,make('plus','放大画布',options.zoomIn),canvasDivider(),make('fit','适应画布',options.fit));
 root.append(modes,topActions,menu,zoom);return {modes,theme,zoom,settings,menu,closeSettings};
}
