import {agentTaskPrompt} from '../shared/agent-task.js';
import type {AIProvider} from '@milkdown/crepe/feature/ai';
type Transport={call(name:string,args:Record<string,unknown>):Promise<any>;send(text:string):Promise<{mode?:string}>};
export function noteAiPrompt(workspaceId:string,id:string){return agentTaskPrompt(workspaceId,{kind:'note',taskId:id},'Milkdown 选文改写')+'\n只改写 selection，不改写整篇笔记，不加解释或代码围栏。保留引文、链接、LaTeX 和事实。complete 只保存候选，等待用户接受或放弃；不得调用 note_write 直接覆盖。';}
export function createNoteAiProvider(workspaceId:string,nodeId:string,transport:Transport,interval=1500):AIProvider{return async function*(context,signal){
 signal.throwIfAborted();const task=await transport.call('whiteboard_note_ai_begin',{workspaceId,nodeId,...context}),requestId=task.id;
 const cancel=()=>{void transport.call('whiteboard_note_ai_cancel',{workspaceId,requestId}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});let completed=false;
 try{signal.throwIfAborted();const sent=await transport.send(noteAiPrompt(workspaceId,requestId));if(sent.mode!=='sent')throw Error('改写请求未发送给当前 Agent，请重试');
  const until=Date.now()+8*60*1000;while(Date.now()<until){signal.throwIfAborted();const result=await transport.call('whiteboard_note_ai_read',{workspaceId,requestId,includeContext:false});signal.throwIfAborted();if(result.status==='cancelled')throw Error('AI 改写已取消');if(result.status==='completed'){completed=true;yield result.markdown;return;}
   await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason??Error('已取消'));},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},interval);signal.addEventListener('abort',abort,{once:true});});
  }throw Error('等待 Agent 改写超时，原文已保留');
 }finally{signal.removeEventListener('abort',cancel);if(!completed)cancel();}
};}
