import {createNoteAiProvider} from '../whiteboard/note-ai-provider.js';
export function installReaderNoteAi(win:Window&{__CODEX_READER_TOKEN__?:string},report:(type:string,payload:object)=>void){
 const pending=new Map<string,{resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
 win.addEventListener('message',event=>{if(event.source!==win.parent||event.data?.type!=='codex-reader:note-ai-reply'||win.__CODEX_READER_TOKEN__&&event.data.codexReaderToken!==win.__CODEX_READER_TOKEN__)return;const entry=pending.get(event.data.payload?.id);if(!entry)return;event.stopImmediatePropagation();clearTimeout(entry.timer);pending.delete(event.data.payload.id);event.data.payload.error?entry.reject(Error(event.data.payload.error)):entry.resolve(event.data.payload.result);});
 function request(nodeId:string,payload:object){return new Promise<any>((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('笔记 AI 请求超时'));},30000);pending.set(id,{resolve,reject,timer});report('codex-reader:note-ai',{id,nodeId,...payload});});}
 return{provider:(workspaceId:string,nodeId:string)=>createNoteAiProvider(workspaceId,nodeId,{call:(name,args)=>request(nodeId,{operation:'tool',name,args}),send:text=>request(nodeId,{operation:'send',requestId:/requestId=([a-f0-9-]{36})/.exec(text)?.[1]})})};
}
