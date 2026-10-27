import {pdfPreprocessingPrompt} from './pdf-preprocessing-request.js';
type Call=(name:string,args:Record<string,unknown>)=>Promise<any>;
export function preprocessingData(result:any){if(result.isError)throw Error(result.content?.find((c:any)=>c.type==='text')?.text??'PDF 数据预处理失败');return result.structuredContent??JSON.parse(result.content?.find((c:any)=>c.type==='text')?.text??'{}');}
export async function cancelPdfPreprocessing(call:Call,workspaceId:string,taskId:string){
 for(let attempt=0;attempt<3;attempt++){
  const data=preprocessingData(await call('whiteboard_pdf_preprocess_read',{workspaceId,taskId}));
  const task=data.task;
  if(!task||!['queued','running'].includes(task.status))return data;
  try{return preprocessingData(await call('whiteboard_pdf_preprocess_status',{workspaceId,taskId,status:'cancelled',message:'用户已停止后续 AI 处理；已保存的资料保留。',expectedRevision:data.revision,requestId:crypto.randomUUID()}));}
  catch(error){if(attempt===2||!/REVISION_CONFLICT|TASK_STATE/.test(String(error)))throw error;}
 }
}
export async function preparePdfResearch(call:Call,workspaceId:string,options:{documentIds?:string[];graph?:boolean;force?:boolean;progress?:(message:string)=>void;signal?:AbortSignal;pause?:()=>Promise<void>}={}){
 const check=()=>{if(options.signal?.aborted){const error=Error('已停止本次流程；已加入队列的本机解析继续在后台运行');error.name='AbortError';throw error;}};check();
 let data=preprocessingData(await call('whiteboard_pdf_preprocess_read',{workspaceId}));check();
 const ids:string[]=options.documentIds??data.documents.map((d:any)=>d.id);if(!ids.length)throw Error('请先添加 PDF');
 if(ids.some(id=>!data.documents.some((d:any)=>d.id===id)))throw Error('PDF 不在当前工作区');
 const missing=ids.filter(id=>!data.documents.find((d:any)=>d.id===id)?.ready);
 if(missing.length){
  const status=(await call('pdf_workspace_mineru_status',{workspaceId}))._meta?.mineruWorkspaceStatus;check();
  if(status?.workspaceId!==workspaceId)throw Error('本机解析状态不匹配');
  const running=new Set(status.statuses.filter((s:any)=>s.engine==='local'&&!['idle','failed','completed'].includes(s.phase)).map((s:any)=>s.documentId));
  const submit=missing.filter(id=>!running.has(id));check();
  if(submit.length){options.progress?.('正在把 '+submit.length+' 份 PDF 加入本机 MinerU 队列…');const answer=await call('pdf_workspace_mineru_batch',{workspaceId,documentIds:submit,options:{modelVersion:'pipeline',isOcr:false}});if(answer.isError)preprocessingData(answer);}
  for(let tries=0;missing.some(id=>!data.documents.find((d:any)=>d.id===id)?.ready);tries++){
   check();if(tries>=7200)throw Error('本机解析等待超时，可再次点击继续');
   const state=(await call('pdf_workspace_mineru_status',{workspaceId}))._meta?.mineruWorkspaceStatus;check();if(state?.workspaceId!==workspaceId)throw Error('本机解析状态不匹配');
   const failed=state.statuses.find((s:any)=>missing.includes(s.documentId)&&!data.documents.find((d:any)=>d.id===s.documentId)?.ready&&s.phase==='failed');if(failed)throw Error('本机解析失败：'+(failed.error??failed.documentId));
   options.progress?.('本机解析 '+ids.filter(id=>data.documents.find((d:any)=>d.id===id)?.ready).length+'/'+ids.length+' 份；完成后自动生成基础卡片');
   await(options.pause?.()??new Promise<void>(resolve=>setTimeout(resolve,3000)));check();data=preprocessingData(await call('whiteboard_pdf_preprocess_read',{workspaceId}));
  }
 }
 check();options.progress?.('正在自动生成基础资料卡片…');
 data=preprocessingData(await call('whiteboard_pdf_preprocess_request',{workspaceId,documentIds:ids,force:options.force??false,expectedRevision:data.revision,requestId:crypto.randomUUID()}));
 if(options.signal?.aborted&&data.task?.id)await cancelPdfPreprocessing(call,workspaceId,data.task.id);
 check();
 return{data,documentIds:ids,prompt:options.graph?pdfPreprocessingPrompt(workspaceId,ids,undefined,true):undefined};
}
