export type NoteDraft={workspaceId:string;nodeId:string;title:string;markdown:string;revision:string};
export type NoteSaveStatus='dirty'|'saving'|'saved'|'error';
export function createNoteDrafts(save:(draft:NoteDraft)=>Promise<{revision:string}>,options:{autoSaveMs?:number;onStatus?:(status:NoteSaveStatus,error?:unknown)=>void}={}){
 let current:NoteDraft|undefined,running:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const clear=()=>{clearTimeout(timer);timer=undefined;};
 function flush(){
  clear();if(running)return running;if(!current)return Promise.resolve();
  options.onStatus?.('saving');
  const task=(async()=>{while(current){const captured:NoteDraft=current,result=await save(captured);if(current===captured)current=undefined;else if(current.nodeId===captured.nodeId&&current.workspaceId===captured.workspaceId)current={...current,revision:result.revision};}})();
  running=task.then(()=>options.onStatus?.('saved'),error=>{options.onStatus?.('error',error);throw error;}).finally(()=>{running=undefined;clear();});return running;
 }
 return {stage(value:NoteDraft){if(current&&current.workspaceId===value.workspaceId&&current.nodeId===value.nodeId&&current.title===value.title&&current.markdown===value.markdown)return;current={...value};if(!running)options.onStatus?.('dirty');clear();if(options.autoSaveMs!==undefined)timer=setTimeout(()=>{void flush().catch(()=>{});},options.autoSaveMs);},flush,pending:()=>!!current};
}
