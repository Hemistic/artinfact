export type DraftSnapshot<T>={key:string;version:number;payload:T};
/** A flush includes edits typed while a previous snapshot is being saved. */
export function createDraftSaver<T>(read:()=>DraftSnapshot<T>|undefined,save:(s:DraftSnapshot<T>)=>Promise<void>,acknowledge:(s:DraftSnapshot<T>)=>void){
 let running:Promise<void>|undefined;
 return{flush(){if(running)return running;const run=async()=>{for(let next=read();next;next=read()){await save(next);acknowledge(next);}};const task=run();running=task.then(()=>{running=undefined;},error=>{running=undefined;throw error;});return running;}};
}
