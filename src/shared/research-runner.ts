import {agentTaskPrompt} from './agent-task.js';
import type {ResearchExecution,ResearchSubmission} from './research-ui.js';
import type {ResearchDelivery} from './research-delivery.js';
import type {WorkbenchScope,WorkbenchTask} from '../whiteboard/research-workbench.js';
import {aiTaskPrompt} from './research-prompts.js';
import {referenceActionPrompt,type PdfReferenceIndex,type PdfReferenceJob} from './pdf-citations.js';

export type ResearchBridge={workspaceId:string;call:(name:string,args:Record<string,unknown>)=>Promise<any>;send:(text:string)=>Promise<ResearchDelivery>;changed?:()=>Promise<void>};
export function researchValue(result:any):any{
 if(result?.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text??'研究请求失败');
 return result?._meta?.referenceResearch??result?._meta?.research??result?.structuredContent?.research??result?.structuredContent??result;
}
const done=(status:string)=>['completed','failed','cancelled'].includes(status);
export async function researchCall(bridge:ResearchBridge,name:string,args:Record<string,unknown>={}){return researchValue(await bridge.call(name,{...args,workspaceId:bridge.workspaceId}));}
export async function researchMutation(bridge:ResearchBridge,name:string,args:Record<string,unknown>){
 const requestId=crypto.randomUUID();for(let i=0;i<3;i++){const state=await researchCall(bridge,'whiteboard_list');try{return await researchCall(bridge,name,{...args,expectedRevision:state.revision,requestId});}catch(e){if(!String(e).includes('REVISION_CONFLICT')||i===2)throw e;}}throw Error('STORE_BUSY');
}
export function workbenchPrompt(workspaceId:string,task:WorkbenchTask){return agentTaskPrompt(workspaceId,{kind:'research',taskId:task.id},'研读工作台：'+task.scope.kind)+(task.scope.kind==='article'?'\n阅读全文后生成少量有来源的文章逻辑模板和留白，不代写全部笔记；只进入＋待添加。':'\n仅分析所选分区成员和内部连接，或连线两端及方向标签。比较结论保留双方证据与实验口径，不覆盖、删除、移动用户卡片。每项 findings 关联实际支撑的已选卡片，系统负责生成和连接结果。');}
export async function runWorkbench(bridge:ResearchBridge,scope:WorkbenchScope,input:ResearchSubmission):Promise<ResearchExecution>{
 const result=await researchMutation(bridge,'whiteboard_research_begin',{scope,instructions:input.instruction,preset:input.preset}),task=result.task as WorkbenchTask,prompt=workbenchPrompt(bridge.workspaceId,task);
 let delivery:ResearchDelivery;try{delivery=await bridge.send(prompt);}catch(e){delivery={mode:'manual',reason:String(e)};}
 await researchMutation(bridge,'whiteboard_research_delivery',{taskId:task.id,mode:delivery.mode});
 return{message:delivery.mode==='sent'?'已交给 Agent，等待 MCP 回写':delivery.mode==='draft'?'已放入聊天草稿，请发送':'尚未发送，请复制指令到聊天',...(delivery.mode==='sent'?{}:{prompt}),read:async()=>{const value=await researchCall(bridge,'whiteboard_research_read',{taskId:task.id});if(done(value.task.status))await bridge.changed?.();return{message:value.task.message,done:done(value.task.status)};},cancel:async()=>{await researchMutation(bridge,'whiteboard_research_status',{taskId:task.id,status:'cancelled',message:'用户停止了研读'});}};
}
export async function runPdfAi(bridge:ResearchBridge,documentIds:string[],scope:'outline'|'insights',input:ResearchSubmission):Promise<ResearchExecution>{
 if(!documentIds.length)throw Error('请先选择论文');
 const jobs:{documentId:string;jobId:string}[]=[];
 try{for(const documentId of documentIds){const job=await researchCall(bridge,'pdf_ai_task_begin',{documentId,scope,instructions:input.instruction});jobs.push({documentId,jobId:job.id});}}
 catch(e){for(const job of jobs)await researchCall(bridge,'pdf_ai_task_fail',{...job,error:'批量创建未完成，未发送给 Agent'}).catch(()=>{});throw e;}
 const prompt=jobs.map(job=>aiTaskPrompt(bridge.workspaceId,job.documentId,scope,job.jobId)).join('\n\n');
 let delivery:ResearchDelivery;try{delivery=await bridge.send(prompt);}catch(e){delivery={mode:'manual',reason:String(e)};}
 for(const job of jobs)await researchCall(bridge,'pdf_ai_task_delivery',{...job,mode:delivery.mode});
 return{message:delivery.mode==='sent'?'已交给 Agent，完成后同步阅读器和资料库':'尚未发送，请在聊天中发送研究指令',...(delivery.mode==='sent'?{}:{prompt}),read:async()=>{const results=await Promise.all(jobs.map(async job=>{const value=await researchCall(bridge,'pdf_ai_read',{documentId:job.documentId});const current=Object.values(value.jobs??{}).find((j:any)=>j.id===job.jobId) as any;return current??{status:'cancelled',error:'任务已替换'};}));const complete=results.every(job=>job.status!=='queued');if(complete)await bridge.changed?.();return{message:results.map((job,i)=>`${i+1}. ${job.status}${job.error?' · '+job.error:''}`).join(' · '),done:complete};},cancel:async()=>{for(const job of jobs){const value=await researchCall(bridge,'pdf_ai_read',{documentId:job.documentId});if(Object.values(value.jobs??{}).some((j:any)=>j.id===job.jobId&&j.status==='queued'))await researchCall(bridge,'pdf_ai_task_cancel',job);}}};
}
export type ReferenceChoice={documentId:string;referenceId:string;markerId:string;revision:string;title:string};
export async function referenceChoices(bridge:ResearchBridge,documentIds:string[]){
 const result:ReferenceChoice[]=[];for(const documentId of documentIds){const index=await researchCall(bridge,'pdf_reference_index',{documentId}) as PdfReferenceIndex;for(const ref of index.references){const marker=index.markers.find(m=>m.sourceIds.includes(ref.id));if(marker)result.push({documentId,referenceId:ref.id,markerId:marker.id,revision:index.revision,title:ref.title});}}return result;
}
export async function runReference(bridge:ResearchBridge,choices:ReferenceChoice[],input:ResearchSubmission):Promise<ResearchExecution>{
 if(!choices.length||choices.length>20)throw Error('请选择 1 至 20 篇引用文献');const jobs:PdfReferenceJob[]=[];
 try{for(const choice of choices)jobs.push(await researchCall(bridge,'pdf_reference_action_begin',{documentId:choice.documentId,referenceId:choice.referenceId,markerId:choice.markerId,revision:choice.revision,action:input.preset==='full'?'study':'abstract',instructions:input.instruction,addToWorkspace:input.preset==='full'&&input.download,requestId:crypto.randomUUID()}));}
 catch(e){for(const job of jobs)await researchCall(bridge,'pdf_reference_action_status',{documentId:job.documentId,taskId:job.id,status:'cancelled',message:'批量创建未完成，未发送'}).catch(()=>{});throw e;}
 const prompt=jobs.map(job=>referenceActionPrompt(job)).join('\n\n');let delivery:ResearchDelivery;try{delivery=await bridge.send(prompt);}catch(e){delivery={mode:'manual',reason:String(e)};}
 for(const job of jobs)await researchCall(bridge,'pdf_reference_action_delivery',{documentId:job.documentId,taskId:job.id,mode:delivery.mode});
 return{message:delivery.mode==='sent'?'已交给 Agent，结果回写 PDF 批注':'尚未发送，请在聊天中发送研究指令',...(delivery.mode==='sent'?{}:{prompt}),read:async()=>{const results=await Promise.all(jobs.map(async job=>{const value=await researchCall(bridge,'pdf_reference_action_read',{documentId:job.documentId,taskId:job.id});return value.task as PdfReferenceJob;}));const complete=results.every(job=>done(job.status));if(complete)await bridge.changed?.();return{message:results.map(job=>job.message).join(' · '),done:complete};},cancel:async()=>{for(const job of jobs)await researchCall(bridge,'pdf_reference_action_status',{documentId:job.documentId,taskId:job.id,status:'cancelled',message:'用户停止了引用研读'});}};
}
