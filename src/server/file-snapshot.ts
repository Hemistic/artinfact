import {readFile,stat} from 'node:fs/promises';
type Snapshot={version:string;value:unknown;bytes:number};
const snapshots=new Map<string,Snapshot>(),pending=new Map<string,Promise<unknown>>();
let bytes=0;const budget=64*1024*1024;
export async function fileVersion(path:string){const value=await stat(path);return [value.dev,value.ino,value.size,value.mtimeMs,value.ctimeMs].join(':');}
function keep(key:string,snapshot:Snapshot){const old=snapshots.get(key);if(old)bytes-=old.bytes;snapshots.delete(key);if(snapshot.bytes>budget)return;snapshots.set(key,snapshot);bytes+=snapshot.bytes;while(bytes>budget){const first=snapshots.keys().next().value!;bytes-=snapshots.get(first)!.bytes;snapshots.delete(first);}}
// Check the actual file version on every read, including writes from other MCP
// processes. Only parsing is cached; no timer can conceal a newer disk version.
export async function readFileSnapshot<T>(path:string,kind:string,parse:(text:string)=>T):Promise<T>{
 const version=await fileVersion(path),key=kind+'\0'+path,hit=snapshots.get(key);
 if(hit?.version===version){snapshots.delete(key);snapshots.set(key,hit);return hit.value as T;}
 const requestKey=key+'\0'+version,existing=pending.get(requestKey);if(existing)return existing as Promise<T>;
 const task=(async()=>{const text=await readFile(path,'utf8'),value=parse(text);if(await fileVersion(path)===version)keep(key,{version,value,bytes:Buffer.byteLength(text)});return value;})();
 pending.set(requestKey,task);try{return await task;}finally{if(pending.get(requestKey)===task)pending.delete(requestKey);}
}
export const readTextSnapshot=(path:string)=>readFileSnapshot(path,'utf8',text=>text);
export async function primeFileSnapshot(path:string,kind:string,value:unknown,size:number){keep(kind+'\0'+path,{version:await fileVersion(path),value,bytes:size});}
