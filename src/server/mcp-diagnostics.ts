import {mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
export function createMcpDiagnostics(root:string,version:string){
 const folder=join(root,'mcp-logs'),path=join(folder,`mcp-${process.pid}.jsonl`);
 const record=(event:string,error?:unknown)=>{
  try{mkdirSync(folder,{recursive:true});const message=error===undefined?undefined:(error instanceof Error?error.message:String(error)).replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1800);
   appendFileSync(path,JSON.stringify({at:new Date().toISOString(),pid:process.pid,version,event,...(message?{message}:{})})+'\n',{mode:0o600});
  }catch{/* A diagnostic write must never break the MCP transport. */}
 };
 return {path,record};
}
