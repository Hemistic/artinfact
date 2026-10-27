import {agentTaskPrompt} from '../shared/agent-task.js';
import type {BoardView} from './whiteboard-domain.js';
import {mcpAssetImageUrl} from './asset-preview.js';
import {toolTimeout} from '../shared/tool-timeout.js';
const workspaceId=document.documentElement.dataset.workspaceId!,token=document.documentElement.dataset.whiteboardToken!;
const pending=new Map<string,{resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
window.addEventListener('beforeunload',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('白板页面已关闭'));}pending.clear();});
window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.token!==token||event.data.type!=='artinfact:whiteboard-response')return;const item=pending.get(event.data.id);if(!item)return;clearTimeout(item.timer);pending.delete(event.data.id);event.data.error?item.reject(Error(event.data.error)):item.resolve(event.data.result);});
function request(type:string,payload:object):Promise<any>{return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('白板操作超时，未确认保存；请保留当前草稿后重试'));},type==='artinfact:whiteboard-tool'?toolTimeout(String((payload as {name?:string}).name)):120000);pending.set(id,{resolve,reject,timer});window.parent.postMessage({type,token,id,payload},'*');});}
async function invoke(name:string,args:Record<string,unknown>={}){const result=await request('artinfact:whiteboard-tool',{name,args:{...args,workspaceId}});if(result.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text??'白板操作失败');return result;}
export async function whiteboardTool<T=any>(name:string,args:Record<string,unknown>={}):Promise<T>{const result=await invoke(name,args);return result.structuredContent??result._meta?.referenceResearch??result._meta?.research??JSON.parse(result.content.find((c:any)=>c.type==='text').text);}
export async function whiteboardAsset(id:string){const result=await invoke('whiteboard_asset_read',{id}),item=result.content.find((c:any)=>c.type==='image');if(!item)throw Error('图片附件缺失');return 'data:'+item.mimeType+';base64,'+item.data;}
export function exportBoardPages(boardId:string,exportName?:string){return request('artinfact:whiteboard-pages',{boardId,export:true,manage:true,...(exportName?{exportName}:{})});}
export async function whiteboardSourceImage(sourceId:string){return mcpAssetImageUrl(await invoke('whiteboard_source_image',{sourceId}));}
export function agentRequest(view:BoardView,taskId?:string){const b=view.board,t=b?.tasks.find(t=>t.status==='queued'&&(!taskId||t.id===taskId));if(!b||!t)return;const kind=t.kind==='card_action'?'card':t.kind==='workflow'?'workflow':'board';return agentTaskPrompt(workspaceId,{kind,boardId:b.id,taskId:t.id},kind==='card'?'卡片研读':kind==='workflow'?'节点与上游研读':'白板分析')+'\n图表解释只回传上方 Markdown，系统保留下方原图与图题；recognize_table 输出 Markdown 表格。draw_explanation 必须实际生成并保存新图，不能复用原图。derive_formula 生成独立推导笔记，原文未给出的步骤标为推断。公式/证据 update 保持原 presentation 类型和 LaTeX；related-note 不传 presentation。工作流只组合 directInputs，其他上游仅作追溯；Pages 必须实际创建并读回全部 blocks，候选改写不得覆盖原笔记。';}
export async function dispatchWhiteboardAgent(view:BoardView,taskId?:string){const text=agentRequest(view,taskId);if(!text)return false;try{return(await request('artinfact:whiteboard-agent',{text})).mode==='sent';}catch{return false;}}
export function setCardContext(target:{boardId:string;nodeId:string}|null){return request('artinfact:whiteboard-context',target??{});}
export function sendNoteAiAgent(text:string){return request('artinfact:whiteboard-agent',{text});}
export async function openPdfSource(sourceId:string){return request('artinfact:whiteboard-pdf',{sourceId});}
export async function openPdfPreprocessing(){return request('artinfact:whiteboard-preprocess',{});}
export function returnWorkspaceHome(){return request('artinfact:whiteboard-home',{});}
export async function locatePdfEvidence(boardId:string,nodeId:string,citationIndex?:number){return request('artinfact:whiteboard-evidence',{boardId,nodeId,...(citationIndex===undefined?{}:{citationIndex})});}
export function locateReference(boardId:string,nodeId:string,referenceIndex:number,referenceRevision:string){return request('artinfact:whiteboard-evidence',{boardId,nodeId,referenceIndex,referenceRevision});}
export async function openPagesCard(boardId:string,target:{nodeId?:string;sourceId?:string},manage=false){return request('artinfact:whiteboard-pages',{boardId,...target,manage});}
