import {mkdir,lstat,realpath,open,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {renameWithRetry} from './atomic-rename.js';
export async function referenceFolder(root:string,...parts:string[]){let path=await realpath(root);for(const part of parts){if(!/^[a-zA-Z0-9_-]+$/.test(part))throw Error('引用缓存路径无效');path=join(path,part);await mkdir(path).catch(e=>{if(e.code!=='EEXIST')throw e;});const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())throw Error('引用缓存不能指向目录之外');}return path;}
export async function referenceJson<T>(path:string,missing:T):Promise<T>{try{if((await stat(path)).size>32*1024*1024)throw Error('引用任务记录超过上限');return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return missing;throw e;}}
export async function writeReferenceJson(path:string,value:unknown){const temporary=path+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await renameWithRetry(temporary,path);}finally{await unlink(temporary).catch(()=>{});}}
export async function referenceLock<T>(path:string,action:()=>Promise<T>){const lockPath=path+'.lock',deadline=Date.now()+6000;let handle;
 while(!handle){try{handle=await open(lockPath,'wx');}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const age=await stat(lockPath).then(s=>Date.now()-s.mtimeMs,()=>0);if(age>60000){await unlink(lockPath).catch(()=>{});continue;}if(Date.now()>deadline)throw Error('引用任务正在保存，请稍后重试');await new Promise(r=>setTimeout(r,35));}}
 try{return await action();}finally{await handle.close();await unlink(lockPath).catch(()=>{});}
}
