import {readFileSnapshot} from './file-snapshot.js';
import { mkdir, readFile, writeFile, unlink, realpath, stat, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import yauzl from 'yauzl';
import { z } from 'zod';
import { MineruPipeline, MineruStartSchema, MineruOptionsSchema, type MineruConfigSchema } from './mineru.js';
import { renameWithRetry } from './atomic-rename.js';
import type { PdfStateStore } from './pdf-store.js';
import type { AnalysisStatus, PageMetric } from '../shared/mineru.js';
import type { LayoutStatus } from '../shared/layout-status.js';
import { resolveReferences } from '../shared/pdf-references.js';
import {parseLocalProgress,type NativeProgress} from '../shared/local-progress.js';
export const LOCAL_MINERU_VERSION = '4.0.10';
export const defaultMineruRoot = (workspace=process.cwd()) => join(workspace,'processors','mineru');
export const mineruPathSettings = (workspace:string) => join(workspace,'.artinfact','mineru-local.json');
export async function resolveLocalMineruRoot(workspace=process.cwd()) {
  if(process.env.CODEX_MINERU_LOCAL_DIR)return process.env.CODEX_MINERU_LOCAL_DIR;
  try { const value=JSON.parse(await readFile(mineruPathSettings(workspace),'utf8'));if(value.version!==1||typeof value.root!=='string'||!isAbsolute(value.root))throw new Error('invalid');return value.source==='workspace-default'?defaultMineruRoot(workspace):value.root; }
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('本机 MinerU 路径配置损坏，请重新设置');return defaultMineruRoot(workspace);}
}
type Installation = { root: string; executable: string };
type Annotation = { id: string; layoutKind: string; position: { pageIndex: number; rects: number[][] }; [key: string]: unknown };
type LocalJob = AnalysisStatus & { token: string; engine: 'local'; name: string; size: number; pages: PageMetric[]; outline?: unknown[]; directory: string; offset: number; options: z.infer<typeof MineruOptionsSchema> };
type RunInput = { sourcePath: string; output: string; installation: Installation; signal: AbortSignal; isOcr: boolean; onProgress?(value:NativeProgress):void };
type Dependencies = { installation?: () => Promise<Installation>; run?: (input: RunInput) => Promise<void> };
let cpuQueue: Promise<unknown> = Promise.resolve();
async function atomic(path: string, value: unknown) { await mkdir(dirname(path),{recursive:true}); const temp=`${path}.${randomUUID()}.tmp`; try { await writeFile(temp,JSON.stringify(value),{mode:0o600}); await renameWithRetry(temp,path); } finally { await unlink(temp).catch(()=>undefined); } }
const inRoot = (root: string, path: string) => { const rel=relative(root,path); return !!rel && !rel.startsWith('..') && !isAbsolute(rel); };

export async function localMineruInstallation(workspace=process.cwd()): Promise<Installation> {
  const root=await resolveLocalMineruRoot(workspace);
  if (typeof root!=='string' || !isAbsolute(root)) throw new Error('本机 MinerU 目录必须为绝对路径');
  try {
    const receipt=JSON.parse(await readFile(join(root,'installation.json'),'utf8'));
    const executable=await realpath(receipt.executable), canonical=await realpath(root);
    if (receipt.version!==1 || receipt.mode!=='auto' || !receipt.standardVerified || receipt.tier!=='standard' || receipt.mineruVersion!==LOCAL_MINERU_VERSION || !inRoot(canonical,executable) || !(await stat(executable)).isFile()) throw new Error('本机处理器安装记录无效或版本不兼容，请重新运行安装与测试');
    try { const progress=JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8')); if (['installing','downloading','testing'].includes(progress.phase)) { try { process.kill(progress.pid,0); } catch { return {root:canonical,executable}; } throw new Error('MinerU 正在安装或测试，请等待完成'); } } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
    return { root:canonical,executable };
  } catch(e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') throw new Error('尚未部署 MinerU。选择下载源，点击“下载并部署”，插件会自动完成安装和测试。'); throw e; }
}

export function localMineruEnvironment(root: string, inherited: NodeJS.ProcessEnv=process.env): NodeJS.ProcessEnv {
  const env={...inherited};
  for (const key of Object.keys(env)) if (key.startsWith('MINERU_') || key.startsWith('LLAMA_ARG_')) delete env[key];
  return { ...env, MINERU_HOME:join(root,'home'), MINERU_CONFIG:join(root,'home','config.yaml'), MINERU_MODEL_SOURCE:'local', MINERU_MODEL_SMALL_BACKEND:'onnx', MINERU_MODEL_VLM_ENGINE:'llama-cpp', LLAMA_ARG_N_PARALLEL:'1', PYTHONUTF8:'1' };
}
function textOf(value: unknown): string {
  if (typeof value==='string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value && typeof value==='object') return textOf((value as any).content ?? (value as any).text ?? (value as any).items ?? '');
  return '';
}
export function normalizeMineruMiddle(raw: any, pages: PageMetric[], documentId: string, jsonPath: string) {
  if (raw?.schema!=='docvortex.middle' || raw.schema_version!=='2.0' || raw.is_full_document!==true) throw new Error('MinerU 未返回完整的 Middle JSON 2.0');
  if (!Array.isArray(raw.pages) || raw.pages.length!==pages.length || raw.pages.some((p:any,i:number)=>p.page_idx!==i || !Array.isArray(p.blocks))) throw new Error('MinerU 结构 JSON 与原 PDF 页数不一致');
  const contentList: Record<string,any>[] = [], annotations: Annotation[]=[];
  const created=new Date().toISOString();
  for (const page of raw.pages) for (const block of page.blocks) {
    const bbox=block.bbox;
    if (!Array.isArray(bbox) || bbox.length!==4 || bbox.some((x:unknown)=>typeof x!=='number' || !Number.isFinite(x) || x<0 || x>1) || bbox[2]<=bbox[0] || bbox[3]<=bbox[1]) throw new Error('MinerU 布局坐标无效，应为 0–1 归一化坐标');
    const pageIndex=page.page_idx, blockIndex=contentList.length;
    const children=Array.isArray(block.content)?block.content:[], body=children.find((c:any)=>/_body$/.test(c.type)) ?? block;
    const caption=children.filter((c:any)=>/_caption$/.test(c.type)).map(textOf).join('\n');
    const footnote=children.filter((c:any)=>/_footnote$/.test(c.type)).map(textOf).join('\n');
    const type=['doc_title','paragraph_title'].includes(block.type)?'text':block.type;
    const item: Record<string,any>={type,page_idx:pageIndex,bbox:bbox.map((x:number)=>x*1000),text:textOf(body.content), ...(block.level?{text_level:block.level}:{}), ...(body.image_path?{img_path:body.image_path}:{}), ...(type==='table'?{table_body:textOf(body.content),table_caption:[caption],table_footnote:[footnote]}:type==='image'||type==='chart'?{image_caption:[caption],image_footnote:[footnote]}:{})};
    if (body.image_path && (!/^images\/[A-Za-z0-9._ /-]+\.(png|jpe?g|webp)$/i.test(body.image_path) || body.image_path.split('/').includes('..'))) throw new Error('MinerU 图片路径超出产物目录');
    if (type==='equation') { item.type='equation'; item.text=textOf(block.content); item.text_format='latex'; }
    contentList.push(item);
    const kind=type==='table'?'table':type==='image'||type==='chart'?'figure':type==='equation'?'equation':undefined;
    if (!kind) continue;
    const metric=pages[pageIndex];
    const rect=[bbox[0]*metric.width,(1-bbox[3])*metric.height,bbox[2]*metric.width,(1-bbox[1])*metric.height].map(x=>Math.round(x*10000)/10000);
    const comment=caption;
    annotations.push({id:'ML'+createHash('sha256').update(`${documentId}:${pageIndex}:${block.index}:${kind}`).digest('hex').slice(0,14),type:'image',color:kind==='table'?'#18a058':kind==='equation'?'#8155ba':'#18a0fb',text:caption,comment,tags:[],dateCreated:created,dateModified:created,pageLabel:String(pageIndex+1),sortIndex:`${String(pageIndex).padStart(5,'0')}|${String(Math.round(bbox[1]*100000)).padStart(6,'0')}|00000`,position:{pageIndex,rects:[rect]},projectOrigin:'layout-json',layoutKind:kind,layoutSourcePath:jsonPath,layoutAssetPath:body.image_path ?? '',layoutBlockIndices:[blockIndex],layoutOriginalComment:comment});
  }
  if (annotations.length>10000 || contentList.length>100000) throw new Error('MinerU 结构超过处理上限');
  return {contentList,annotations,coordinateSpace:{pageBounds:pages.map(()=>({sourceWidth:1000,sourceHeight:1000})),documentSourceWidth:1000,documentSourceHeight:1000}};
}

// ZIP is produced by the official stateless parser; extract only inside the new run directory.
export async function extractLocalMineruZip(file: string, output: string) {
  await mkdir(output,{recursive:true}); let total=0, count=0;
  await new Promise<void>((ok,fail)=>yauzl.open(file,{lazyEntries:true},(error:any,zip:any)=>{
    if(error) return fail(error); zip.on('error',fail); zip.on('end',ok);
    zip.on('entry',(entry:any)=>{ void (async()=>{
      const path=entry.fileName;
      if (++count>20000 || /[\\\u0000]/.test(path) || !inRoot(resolve(output),resolve(output,path)) || path.split('/').some((s:string)=>s==='..') || (entry.externalFileAttributes>>>16 & 0xf000)===0xa000) throw new Error('MinerU ZIP 路径无效');
      total+=entry.uncompressedSize; if(total>512*1024*1024) throw new Error('MinerU 产物超过 512 MB');
      if(path.endsWith('/')) await mkdir(resolve(output,path),{recursive:true});
      else { const target=resolve(output,path); await mkdir(dirname(target),{recursive:true}); const data=await new Promise<Buffer>((done,reject)=>zip.openReadStream(entry,(e:any,stream:any)=>{if(e)return reject(e);const chunks:Buffer[]=[];stream.on('data',(chunk:Buffer)=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>done(Buffer.concat(chunks)));})); await writeFile(target,data,{flag:'wx',mode:0o600}); }
      zip.readEntry();
    })().catch(e=>{zip.close();fail(e);}); }); zip.readEntry();
  }));
}
export const localParseArguments = (source: string, zip: string, isOcr: boolean) => ['parse',source,'-o',zip,'--tier','standard','--format','zip','--pages','all','--ocr-mode',isOcr?'ocr':'auto'];
async function runLocalMineru(input: RunInput) {
  // A low-integrity Windows Python cannot write ordinary Temp. LocalLow preserves
  // that boundary without changing executable or system-directory permissions.
  // Native PDF dependencies also need short paths, away from the workspace hash.
  const temporaryRoot=process.platform==='win32'?join(homedir(),'AppData','LocalLow','Artinfact','mineru-temp'):tmpdir();
  await mkdir(temporaryRoot,{recursive:true});
  const staging=await mkdtemp(join(temporaryRoot,'ami-')), zip=join(staging,'result.zip'), source=join(staging,'source.pdf'), logPath=join(dirname(input.output),'mineru-process.log');
  const env={...localMineruEnvironment(input.installation.root),TMPDIR:staging,TEMP:staging,TMP:staging};
  try {
  input.signal.throwIfAborted();
  const python=join(dirname(input.installation.executable),process.platform==='win32'?'python.exe':'python');
  const probe='import tempfile; f=tempfile.TemporaryFile(); f.write(b"artinfact-temp-check"); f.flush(); f.close(); d=tempfile.TemporaryDirectory(); d.cleanup()';
  try {
    await new Promise<void>((ok,fail)=>execFile(python,['-I','-c',probe],{env,cwd:staging,windowsHide:true,timeout:30000,signal:input.signal},(error,_stdout,stderr)=>error?fail(new Error(stderr.trim()||error.message)):ok()));
  } catch(error) {
    input.signal.throwIfAborted();
    throw new Error(`MinerU 临时目录写入预检失败：${staging}。Python 无法创建临时文件，请检查处理器权限和磁盘空间。\n${error instanceof Error?error.message:String(error)}`);
  }
  await writeFile(logPath,`Artinfact MinerU temporary directory verified: ${staging}\n`,{flag:'a'});
  await copyFile(input.sourcePath,source);
  input.signal.throwIfAborted();
  await new Promise<void>((ok,fail)=>{
    const log=createWriteStream(logPath,{flags:'a'});
    const child=spawn(input.installation.executable,localParseArguments(source,zip,input.isOcr),{shell:false,windowsHide:true,env,cwd:staging,stdio:['ignore','pipe','pipe']});
    let tail='', settled=false;
    const stop=()=>{ if (child.pid && process.platform==='win32') execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>undefined); else child.kill('SIGTERM'); };
    const timer=setTimeout(stop,2*60*60*1000); timer.unref(); input.signal.addEventListener('abort',stop,{once:true});
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);input.signal.removeEventListener('abort',stop);log.end(()=>error?fail(error):ok());};
    let lastProgress='';const receive=(chunk:Buffer)=>{log.write(chunk);tail=(tail+chunk.toString('utf8')).slice(-6000);const progress=parseLocalProgress(tail),signature=JSON.stringify(progress);if(progress&&signature!==lastProgress){lastProgress=signature;input.onProgress?.(progress);}};
    log.on('error',e=>{stop();finish(e);}); child.stdout.on('data',receive); child.stderr.on('data',receive);
    child.once('error',finish); child.once('close',code=>finish(code===0&&!input.signal.aborted?undefined:new Error(`MinerU 本机 解析失败（exit ${code}）。日志：${logPath}\n${tail.replace(/\x1b\[[0-9;]*m/g,'').slice(-800)}`)));
  });
  await extractLocalMineruZip(zip,input.output);
  } finally { await rm(staging,{recursive:true,force:true}); }
}

export class LocalMineruPipeline extends MineruPipeline {
  private active=new Map<string,Promise<void>>(); private uploadsLocal=new Map<string,{job:LocalJob;bytes:Buffer}>(); private controllers=new Set<AbortController>(); private mutation=Promise.resolve(); private stopped=false;
  constructor(private localStore:PdfStateStore,private dependencies:Dependencies={}) {super(localStore);}
  private directory(id:string) { if(!/^[a-f0-9]{64}$/.test(id)) throw new Error('文档编号无效'); return this.localStore.mineruFolder(id); }
  private async load(id:string):Promise<LocalJob|undefined> {try {const value=JSON.parse(await readFile(join(this.directory(id),'job.json'),'utf8')); if(value.documentId!==id || !inRoot(resolve(this.directory(id)),resolve(value.directory))) throw new Error('MinerU 任务目录无效'); return value;} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  private async persistLocal(job:LocalJob,replace=false) {const current=await this.load(job.documentId);if(!replace&&current?.token!==job.token)throw new Error('本机 MinerU 任务已被替换');job.updatedAt=new Date().toISOString();await atomic(join(this.directory(job.documentId),'job.json'),job);}
  private publicLocal(job:LocalJob):AnalysisStatus { const {documentId,token,engine,phase,label,progress,figures,tables,stats,error,updatedAt}=job;return {documentId,token,engine,phase,label,progress,figures,tables,stats,error,updatedAt}; }
  private exclusive<T>(fn:()=>Promise<T>) { const next=this.mutation.then(fn,fn);this.mutation=next.then(()=>undefined,()=>undefined);return next; }
  async settings() {let installed=false,error='';try {await (this.dependencies.installation??localMineruInstallation)();installed=true;} catch(e){error=e instanceof Error?e.message:String(e);}return {baseUrl:'local://mineru',hasClientKey:false,engine:'local',mode:'auto',tier:'standard',installed,error};}
  async configure(_input:z.infer<typeof MineruConfigSchema>):Promise<Awaited<ReturnType<MineruPipeline['configure']>>> {throw new Error('本机模式请使用“本机 MinerU 设置”；不需要 Server 或 Key');}
  async status(id:string):Promise<AnalysisStatus> {
    const job=await this.load(id); if(!job)return {documentId:id,phase:'idle',engine:'local'};
    if(job.engine!=='local') return {...this.publicLocal(job),phase:job.phase==='completed'?'completed':'failed',label:job.phase==='completed'?'已有旧解析结果；解析布局将生成本机 Markdown 和 JSON':'旧转换任务已停用，请用本机 MinerU 重新解析'};
    if(!['completed','failed'].includes(job.phase)&&!this.active.has(id)&&!this.uploadsLocal.has(job.token)) {
      // A second host process only reads a live owner's task; an interrupted owner requires an explicit retry.
      try {const lock=JSON.parse(await readFile(join(job.directory,'owner.json'),'utf8'));process.kill(lock.pid,0);return this.publicLocal(job);}catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT'&&(e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
      job.phase='failed';job.error='本机解析已中断，请重新解析；原有结果保留。';await this.persistLocal(job);
    }
    return this.publicLocal(job);
  }
  private async make(input:z.input<typeof MineruStartSchema>) {
    const args=MineruStartSchema.parse(input);if(/[\\/\u0000-\u001f]/.test(args.name)||!/\.pdf$/i.test(args.name))throw new Error('无效 PDF 文件名');
    const prior=await this.status(args.documentId);if(!['idle','completed','failed'].includes(prior.phase))throw new Error('当前 PDF 正在本机解析');
    const token=randomUUID(),directory=join(this.directory(args.documentId),'runs',token);await mkdir(join(directory,'output'),{recursive:true});
    return {...args,token,directory,engine:'local',options:MineruOptionsSchema.parse(args.options??{}),phase:'receiving',offset:0,label:'准备本机标准解析'} as LocalJob;
  }
  private verify(job:{documentId:string;size:number},bytes:Buffer) {if(bytes.length!==job.size||createHash('sha256').update(bytes).digest('hex')!==job.documentId||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('PDF 内容与当前文档不一致');}
  async start(input:z.input<typeof MineruStartSchema>) {return this.exclusive(async()=>{await (this.dependencies.installation??localMineruInstallation)();if(this.uploadsLocal.size>=2)throw new Error('请等待当前 PDF 传输完成');const job=await this.make(input);this.uploadsLocal.set(job.token,{job,bytes:Buffer.alloc(job.size)});await this.persistLocal(job,true);return this.publicLocal(job) as AnalysisStatus&{token:string};});}
  upload(token:string,offset:number,data:string) {const item=this.uploadsLocal.get(token);if(!item||offset!==item.job.offset||data.length>1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw new Error('PDF 传输片段无效');const bytes=Buffer.from(data,'base64');if(!bytes.length||offset+bytes.length>item.bytes.length)throw new Error('PDF 传输越界');bytes.copy(item.bytes,offset);item.job.offset+=bytes.length;}
  async run(token:string) {const item=this.uploadsLocal.get(token);if(!item||item.job.offset!==item.bytes.length)throw new Error('PDF 尚未完整传输');this.verify(item.job,item.bytes);await writeFile(join(item.job.directory,'source.pdf'),item.bytes);this.uploadsLocal.delete(token);await this.enqueue(item.job);return this.publicLocal(item.job);}
  async startBatch(items:Array<z.input<typeof MineruStartSchema>&{sourcePath:string}>,control:{restartQueued?:boolean;reconvertCompleted?:boolean}={}) {return this.exclusive(async()=>{
    await (this.dependencies.installation??localMineruInstallation)();if(!items.length||items.length>200||new Set(items.map(i=>i.documentId)).size!==items.length)throw new Error('PDF 数量无效或重复');
    const jobs:AnalysisStatus[]=[],skipped:AnalysisStatus[]=[];
    for(const item of items){const prior=await this.status(item.documentId);if(!['idle','failed'].includes(prior.phase)&&!(control.reconvertCompleted&&prior.phase==='completed')){skipped.push(prior);continue;}await this.active.get(item.documentId);const bytes=await readFile(item.sourcePath);this.verify(item,bytes);const job=await this.make(item);await writeFile(join(job.directory,'source.pdf'),bytes);await this.persistLocal(job,true);await this.enqueue(job);jobs.push(this.publicLocal(job));}return {jobs,skipped};
  });}
  private async enqueue(job:LocalJob) {
    job.phase='creating';job.label='等待本机解析';await atomic(join(job.directory,'owner.json'),{pid:process.pid});await this.persistLocal(job);
    const task=cpuQueue.catch(()=>undefined).then(()=>this.execute(job)).finally(async()=>{await unlink(join(job.directory,'owner.json')).catch(()=>undefined);this.active.delete(job.documentId);});
    this.active.set(job.documentId,task);cpuQueue=task;
  }
  private async execute(job:LocalJob) {
    const abort=new AbortController();this.controllers.add(abort);
    try {
      if(this.stopped)throw new Error('本机处理器已停止');const installation=await (this.dependencies.installation??localMineruInstallation)();
      job.phase='parsing';job.label='本机标准解析 · 生成 Markdown 和坐标 JSON';job.progress={totalPages:job.pages.length};await this.persistLocal(job);
      let progressWrites=Promise.resolve();let progressError:unknown;
      try {await (this.dependencies.run??runLocalMineru)({sourcePath:join(job.directory,'source.pdf'),output:join(job.directory,'output'),installation,signal:abort.signal,isOcr:job.options.isOcr,onProgress:value=>{progressWrites=progressWrites.then(async()=>{job.progress={totalPages:job.pages.length,percent:value.percent,step:value.step};await this.persistLocal(job);}).catch(error=>{progressError=error;});}});}finally{await progressWrites;}
      if(progressError)throw progressError;
      if(abort.signal.aborted)throw new Error('本机解析已停止');
      const output=join(job.directory,'output');const raw=JSON.parse(await readFile(join(output,'middle_json.json'),'utf8'));const markdown=await readFile(join(output,'markdown.md'),'utf8');
      if(!markdown.trim()||Buffer.byteLength(markdown)>80*1024*1024)throw new Error('本机 MinerU Markdown 为空或超过处理上限');
      const converted=normalizeMineruMiddle(raw,job.pages,job.documentId,join(output,'document-mineru.json'));
      await writeFile(join(output,'document-mineru.md'),markdown);await atomic(join(output,'document-mineru.json'),converted.contentList);
      job.phase='indexing';job.label='从同次 MinerU JSON 建立图表框和章节结构';await this.persistLocal(job);
      Object.assign(job,await this.index(job,converted),{phase:'completed',label:'本机 Markdown、JSON 和布局解析完成',progress:{extractedPages:job.pages.length,totalPages:job.pages.length}});await this.persistLocal(job);
    }catch(e){job.phase='failed';job.error=(e instanceof Error?e.message:String(e)).slice(-1400);await this.persistLocal(job);}finally{this.controllers.delete(abort);}
  }
  async cachedLayoutStatus(id:string):Promise<LayoutStatus|undefined> {
    let result;try{result=await this.result(id);}catch(e){if((e as Error).message==='请先完成 MinerU 转换')return;throw e;}
    if(result.format==='markdown-only')return;
    try{
      const data=await readFileSnapshot(join(result.directory,'document-mineru.json'),'mineru-json',text=>JSON.parse(text));
      if(!Array.isArray(data)&&!Array.isArray(data?.pages))throw new Error('布局 JSON 格式无效');
      const boxes=await readFileSnapshot(join(result.directory,'layout.json'),'mineru-json',text=>JSON.parse(text)) as Annotation[];
      if(!Array.isArray(boxes))throw new Error('布局框缓存无效');
      return {token:result.directory,phase:'completed',completedPages:result.pages.length,totalPages:result.pages.length,figures:boxes.filter(a=>a.layoutKind==='figure').length,tables:boxes.filter(a=>a.layoutKind==='table').length,equations:boxes.filter(a=>a.layoutKind==='equation').length,modelVersion:'MinerU 本机 '+LOCAL_MINERU_VERSION};
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  }
  async layout(id:string) {const result=await this.result(id);const boxes=await readFileSnapshot(join(result.directory,'layout.json'),'mineru-json',text=>JSON.parse(text)) as Annotation[];const saved=(await this.localStore.read(id)).annotations;return boxes.map(a=>saved.find(b=>b.id===a.id)??a);}
  async references(id:string,text:string,citationTexts:string[]=[],citationNumbers:string[]=[]) {let result;try{result=await this.result(id);}catch{return super.references(id,text,citationTexts,citationNumbers);}return result.format==='markdown-only'?resolveReferences(text,new Map(),citationTexts,citationNumbers):super.references(id,text,citationTexts,citationNumbers);}
  async layoutStatus(id:string):Promise<LayoutStatus> {const status=await this.status(id);if(['idle','failed','completed'].includes(status.phase)){const cached=await this.cachedLayoutStatus(id);if(cached)return cached;}const total=status.progress?.totalPages??0;return {token:status.token,phase:status.engine!=='local'||status.phase==='completed'?'idle':status.phase==='idle'?'idle':status.phase==='failed'?'failed':status.phase==='creating'?'queued':'running',completedPages:status.progress?.extractedPages??0,totalPages:total,figures:status.figures??0,tables:status.tables??0,equations:status.stats?.equationCount??0,modelVersion:'MinerU 本机 '+LOCAL_MINERU_VERSION,error:status.error};}
  async settled(id:string) {await this.active.get(id);}
  async read(_id:string,_kind:'markdown'|'json'|'bundle',_offset:number,_length:number):Promise<{offset:number;total:number;data:string}>{throw new Error('Markdown 与结构 JSON 仅供知识图谱和图表引用，不支持直接导出');}
  async close() {this.stopped=true;for(const abort of this.controllers)abort.abort();await Promise.allSettled([...this.active.values()]);this.uploadsLocal.clear();await super.close();}
}
