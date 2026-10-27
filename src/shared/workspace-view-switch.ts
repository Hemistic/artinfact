import {canvasIcon} from '../whiteboard/canvas-icons.js';
import {bindControlTooltip} from './control-tooltip.js';
import {workspaceKnowledgeEntries,type WorkspaceGraphMode} from './workspace-graph-views.js';
export function createWorkspaceViewSwitch(options:{mode?:WorkspaceGraphMode;disabled?:boolean;select(mode:WorkspaceGraphMode):void|Promise<void>;onError(message:string):void}){
 const group=document.createElement('div');group.className='workspace-view-switch';group.setAttribute('role','group');group.setAttribute('aria-label','切换图谱和白板');
 let pending=false;
 for(const entry of workspaceKnowledgeEntries){const control=document.createElement('button');control.type='button';control.dataset.mode=entry.mode;control.disabled=!!options.disabled;control.setAttribute('aria-label',entry.title);control.setAttribute('aria-pressed',String(entry.mode===options.mode));control.append(canvasIcon(entry.icon));bindControlTooltip(control);
  control.onclick=()=>{if(pending||control.disabled)return;pending=true;control.setAttribute('aria-busy','true');void Promise.resolve().then(()=>options.select(entry.mode)).then(()=>{for(const button of group.querySelectorAll('button[data-mode]'))button.setAttribute('aria-pressed',String(button===control));}).catch(error=>options.onError(String(error))).finally(()=>{pending=false;control.removeAttribute('aria-busy');});};group.append(control);
 }return group;
}
