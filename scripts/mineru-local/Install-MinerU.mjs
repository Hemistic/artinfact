import {mkdir,readFile,writeFile,rename,unlink,open,stat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const VERSION='4.0.10';
export function samplePdf(){
 const stream='BT /F1 20 Tf 72 700 Td (Artinfact MinerU installation test) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.7\n';const offsets=[];for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);}finally{await unlink(temp).catch(()=>undefined);}}
async function run(command,args,env){
 process.stdout.write(`Running ${command}\n`);
 await new Promise((ok,fail)=>{const child=spawn(command,args,{shell:false,stdio:['ignore','inherit','inherit'],env});child.once('error',fail);child.once('exit',(code,signal)=>code===0?ok():fail(new Error(`Command failed (${code??signal}): ${command}`)));});
}
export async function installMineru(options={},execute=run){
 const workspace=resolve(options.workspace??join(homedir(),'Documents','Artinfact'));
 const root=resolve(options.root??join(workspace,'processors','mineru'));
 const source=options.source??'auto',operationId=options.operationId??randomUUID();
 if(!['auto','modelscope','huggingface'].includes(source))throw new Error('Invalid model source');
 await mkdir(root,{recursive:true});
 const lockPath=join(root,'install.lock');let lock;
 try{lock=await open(lockPath,'wx');}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const owner=Number(await readFile(lockPath,'utf8'));if(!Number.isSafeInteger(owner)||owner<1)throw new Error('Installer lock is invalid');
  try{process.kill(owner,0);throw new Error('MinerU is already being installed');}catch(e){if(e.code!=='ESRCH')throw e;}
  await unlink(lockPath);lock=await open(lockPath,'wx');
 }
 await lock.writeFile(String(process.pid));
 const progress=(phase,label)=>atomic(join(root,'installation-progress.json'),{phase,label,pid:process.pid,operationId,log:join(root,'installer-bootstrap.log'),updatedAt:new Date().toISOString()});
 try{
  await progress('installing','安装 macOS 独立环境与 MinerU 基础依赖');
  const env={...process.env,UV_CACHE_DIR:join(root,'cache'),UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_INSTALL_DIR:join(root,'tools'),UV_NO_MODIFY_PATH:'1',UV_NO_PROGRESS:'1',PYTHONUNBUFFERED:'1',PYTHONUTF8:'1'};
  for(const key of Object.keys(env))if(key.startsWith('MINERU_')||key.startsWith('LLAMA_ARG_'))delete env[key];
  const uv=join(root,'tools','uv');
  if(!(await stat(uv).catch(()=>undefined))?.isFile()){
   await mkdir(join(root,'tools'),{recursive:true});const bootstrap=join(root,'install-uv.sh');
   await execute('/usr/bin/curl',['--fail','--location','--retry','3','--connect-timeout','30','--max-time','180','https://astral.sh/uv/0.12.23/install.sh','--output',bootstrap],env);
   await execute('/bin/sh',[bootstrap],env);
  }
  const venv=join(root,'cpu-env'),python=join(venv,'bin','python'),kit=join(venv,'bin','mineru-kit');
  if(!(await stat(python).catch(()=>undefined))?.isFile())await execute(uv,['venv','--python','3.12.15','--managed-python',venv],env);
  await execute(uv,['pip','install','--python',python,`mineru==${VERSION}`],env);
  await execute(uv,['pip','check','--python',python],env);
  const home=join(root,'home');await mkdir(home,{recursive:true});
  await writeFile(join(home,'config.yaml'),'model:\n  source: local\n  small_backend: onnx\n  vlm:\n    engine: llama-cpp\n');
  Object.assign(env,{MINERU_HOME:home,MINERU_CONFIG:join(home,'config.yaml'),MINERU_MODEL_SMALL_BACKEND:'onnx',MINERU_MODEL_VLM_ENGINE:'llama-cpp',LLAMA_ARG_N_PARALLEL:'1'});
  await execute(kit,['--version'],env);
  await progress('downloading','下载并校验 ONNX 与 llama.cpp 模型');
  await execute(kit,['models','download','--tier','standard','--small-backend','onnx','--vlm-engine','llama-cpp','--source',source],env);
  env.MINERU_MODEL_SOURCE='local';
  await execute(kit,['models','verify','--tier','standard','--small-backend','onnx','--vlm-engine','llama-cpp'],env);
  const smoke=join(root,'smoke-'+randomUUID());await mkdir(smoke);const pdf=join(smoke,'sample.pdf'),zip=join(smoke,'result.zip'),output=join(smoke,'output');
  await writeFile(pdf,samplePdf());await progress('testing','真实 PDF 解析，校验 Markdown 与 Middle JSON');
  await execute(kit,['parse',pdf,'-o',zip,'--tier','standard','--format','zip','--pages','1'],env);
  // Inspect generated local ZIP with the isolated environment, avoiding a dependency on system unzip/Python.
  await execute(python,['-c',`import json,zipfile,pathlib,sys,datetime
z=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);root=pathlib.Path(sys.argv[3]);out.mkdir()
with zipfile.ZipFile(z) as archive:
 for entry in archive.infolist():
  dest=(out/entry.filename).resolve()
  if not dest.is_relative_to(out.resolve()): raise ValueError('Archive path escapes output')
 archive.extractall(out)
md=next(out.rglob('markdown.md'));middle=next(out.rglob('middle_json.json'));data=json.loads(middle.read_text());pages=data.get('pages',[])
assert md.read_text().strip() and data.get('schema')=='docvortex.middle' and data.get('schema_version')=='2.0' and data.get('is_full_document') is True and len(pages)==1 and pages[0].get('blocks'), 'Invalid Standard parse output'
report={'testedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mineruVersion':'${VERSION}','mode':'auto','tier':'standard','samplePdf':str(z.parent/'sample.pdf'),'output':str(out),'markdownBytes':md.stat().st_size,'jsonBytes':middle.stat().st_size,'blocks':len(pages[0]['blocks'])}
(root/'smoke-test.json').write_text(json.dumps(report))`,zip,output,root],env);
  const report=JSON.parse(await readFile(join(root,'smoke-test.json'),'utf8'));
  if(!report.blocks||!report.markdownBytes||!report.jsonBytes)throw new Error('PDF smoke test did not pass');
  await atomic(join(root,'installation.json'),{version:1,mode:'auto',tier:'standard',mineruVersion:VERSION,root,executable:kit,home,standardVerified:true,testedAt:report.testedAt});
  await mkdir(join(workspace,'.artinfact'),{recursive:true});await atomic(join(workspace,'.artinfact','mineru-local.json'),{version:1,root,source:root===join(workspace,'processors','mineru')?'workspace-default':'custom'});
  await progress('completed','macOS MinerU 部署与真实 PDF 测试通过');
  return report;
 }catch(error){await progress('failed',error.message);throw error;}
 finally{await lock.close();await unlink(lockPath).catch(()=>undefined);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const flags=new Map();for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i]?.startsWith('--')||!process.argv[i+1])throw new Error('Invalid installer arguments');flags.set(process.argv[i],process.argv[i+1]);}
 for(const key of flags.keys())if(!['--install-dir','--workspace-dir','--model-source','--install-id'].includes(key))throw new Error(`Unknown argument: ${key}`);
 for(const key of ['--install-dir','--workspace-dir'])if(flags.has(key)&&!isAbsolute(flags.get(key)))throw new Error('Installer directories must be absolute');
 installMineru({root:flags.get('--install-dir'),workspace:flags.get('--workspace-dir'),source:flags.get('--model-source'),operationId:flags.get('--install-id')}).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
