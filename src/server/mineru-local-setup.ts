import { readFile, mkdir, writeFile, unlink, open, stat } from 'node:fs/promises';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveLocalMineruRoot, mineruPathSettings, localMineruInstallation } from './mineru-local.js';
import { renameWithRetry } from './atomic-rename.js';
import {parseLocalProgress} from '../shared/local-progress.js';

const activePhases=['starting','installing','downloading','testing'];
async function atomic(path:string,value:unknown){await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value));await renameWithRetry(tmp,path);}finally{await unlink(tmp).catch(()=>undefined);}}

export async function launchMineruDeployment(args:{root:string;workspace:string;modelSource:string;script?:string;platform?:NodeJS.Platform}) {
  const platform=args.platform??process.platform;
  if(!['win32','darwin'].includes(platform))throw new Error('自动部署目前支持 Windows 和 macOS');
  const script=args.script??fileURLToPath(new URL(platform==='darwin'?'../../scripts/mineru-local/Install-MinerU.mjs':'../../scripts/mineru-local/Install-MinerU.ps1',import.meta.url));
  if(!(await stat(script)).isFile())throw new Error('插件安装脚本缺失，请更新插件');
  const operationId=randomUUID(),path=join(args.root,'installation-progress.json'),log=join(args.root,'installer-bootstrap.log');
  await atomic(path,{phase:'starting',label:'正在启动自动下载与部署',pid:process.pid,operationId,log,updatedAt:new Date().toISOString()});
  const output=await open(log,'w');
  async function failed(reason:string){try{const value=JSON.parse(await readFile(path,'utf8'));if(value.operationId===operationId&&activePhases.includes(value.phase))await atomic(path,{...value,phase:'failed',label:reason,log,updatedAt:new Date().toISOString()});}catch{/* Retain script output if status could not be written. */}}
  try{
    // Windows PowerShell 5.1 exits before executing -File under DETACHED_PROCESS.
    const env={...process.env};
    // PowerShell Core module paths shadow incompatible Windows PowerShell 5.1 modules.
    for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
    const command=platform==='darwin'?process.execPath:'powershell.exe';
    const argumentsList=platform==='darwin'?[script,'--install-dir',args.root,'--workspace-dir',args.workspace,'--model-source',args.modelSource,'--install-id',operationId]:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-InstallDir',args.root,'-WorkspaceDir',args.workspace,'-ModelSource',args.modelSource,'-InstallId',operationId];
    const child=spawn(command,argumentsList,{detached:platform==='darwin',windowsHide:true,stdio:['ignore',output.fd,output.fd],shell:false,cwd:args.workspace,env});
    child.once('error',e=>{void failed('无法启动部署：'+e.message);});
    child.once('exit',code=>{void failed(`部署进程退出（${code}），请查看安装详情并重试`);});
    await new Promise<void>((ok,reject)=>{child.once('error',reject);child.once('spawn',ok);});
    const state=JSON.parse(await readFile(path,'utf8'));
    if(state.operationId===operationId&&state.phase==='starting')await atomic(path,{...state,phase:'installing',pid:child.pid});
    child.unref();return JSON.parse(await readFile(path,'utf8'));
  }catch(e){await failed('部署启动失败：'+String(e));throw e;}finally{await output.close();}
}

async function setupStatus(workspace:string) {
  const root=await resolveLocalMineruRoot(workspace);let installed=false,error='',progress:any;
  try{await localMineruInstallation(workspace);installed=true;}catch(e){error=e instanceof Error?e.message:String(e);}
  try{progress=JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8'));if(activePhases.includes(progress.phase))try{process.kill(progress.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')progress={...progress,phase:'failed',label:'部署进程已中断，请点击重试'};else throw e;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let detail='';if(['downloading','testing','failed'].includes(progress?.phase))try{const tail=(await readFile(join(root,'installer-bootstrap.log'),'utf8')).slice(-12000);if(progress.phase==='failed')detail=tail.slice(-2000);else {const native=parseLocalProgress(tail);if(native&&(progress.phase!=='testing'||/predict|ocr|recogniz/i.test(native.step)))progress={...progress,...native};}}catch{/* The transcript may be the only available log. */}
  return {root,workspace,installed,error,progress,detail,mode:'auto',tier:'standard',environmentOverride:!!process.env.CODEX_MINERU_LOCAL_DIR};
}
export function registerLocalMineruSetup(server:McpServer,workspace=()=>process.cwd()) {
  const meta={ui:{visibility:['app']}},read={readOnlyHint:true,destructiveHint:false,openWorldHint:false};let launching=false;
  const respond=async(fn:()=>Promise<unknown>)=>{try{return {content:[],_meta:{processor:await fn()}};}catch(e){return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:String(e)}]};}};
  server.registerTool('pdf_processor_read',{description:'读取当前工作目录下本机 MinerU 的自动部署、模型下载及真实测试状态。',inputSchema:{},_meta:meta,annotations:read},()=>respond(()=>setupStatus(workspace())));
  server.registerTool('pdf_processor_update',{description:'用户保存本机 MinerU 处理器目录；默认使用当前工作目录下 processors/mineru。',inputSchema:{root:z.string().min(1).max(4000)},_meta:meta,annotations:{...read,readOnlyHint:false}},a=>respond(async()=>{
    if(process.env.CODEX_MINERU_LOCAL_DIR)throw new Error('当前由 CODEX_MINERU_LOCAL_DIR 指定目录，请修改该环境变量');
    const state=await setupStatus(workspace());if(launching||activePhases.includes(state.progress?.phase))throw new Error('部署过程中不能修改目录');
    if(!isAbsolute(a.root)||/\u0000/.test(a.root))throw new Error('请输入本机处理器绝对路径');
    await atomic(mineruPathSettings(workspace()),{version:1,root:resolve(a.root),source:'custom'});return setupStatus(workspace());
  }));
  server.registerTool('pdf_processor_install',{description:'用户点击后自动下载并部署 MinerU 到当前工作目录，安装独立环境、下载模型、解析测试 PDF；不需要手动运行脚本。',inputSchema:{modelSource:z.enum(['auto','modelscope','huggingface']).default('modelscope')},_meta:meta,annotations:{...read,readOnlyHint:false,openWorldHint:true}},a=>respond(async()=>{
    if(!['win32','darwin'].includes(process.platform))throw new Error('自动部署目前支持 Windows 和 macOS');
    const directory=workspace(),state=await setupStatus(directory);if(launching||activePhases.includes(state.progress?.phase))return state;
    launching=true;
    try{return {...state,progress:await launchMineruDeployment({root:state.root,workspace:directory,modelSource:a.modelSource})};}
    finally{launching=false;}
  }));
}
