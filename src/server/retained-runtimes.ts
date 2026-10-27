import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
// The host can remove an old package while its MCP process is still running.
// Retain these small, pure JS runtimes before that happens. Never resolve a
// different release: its contracts may differ from those of this process.
function retain(path:string){
 let value:any,error:unknown;
 try{value=require(fileURLToPath(new URL(path,import.meta.url)));}catch(cause){error=cause;}
 return ()=>{if(error)throw error;return value;};
}
export const mineruLayoutRuntime=retain('../../vendor/mineru/runtime/layout.cjs');
export const mineruTreeRuntime=retain('../../vendor/mineru/runtime/tree.cjs');
export const wikiRuntime=retain('../../vendor/research/runtime/wiki.cjs');
