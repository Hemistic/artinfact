import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const installerUrl=new URL('../scripts/mineru-local/Install-MinerU.mjs',import.meta.url).href;

test('failed macOS dependency download never marks the processor ready and releases its installation lock',async()=>{
 const {installMineru}=await import(installerUrl);const workspace=await mkdtemp(join(tmpdir(),'mineru-mac-fail-')),root=join(workspace,'processor');
 try{
  await assert.rejects(()=>installMineru({workspace,root,operationId:'test-failed'},async()=>{throw new Error('Download unavailable');}),/Download unavailable/);
  const progress=JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8'));
  assert.equal(progress.phase,'failed');assert.equal(progress.operationId,'test-failed');
  assert.equal(await stat(join(root,'installation.json')).catch(()=>undefined),undefined);
  assert.equal(await stat(join(root,'install.lock')).catch(()=>undefined),undefined);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
test('macOS readiness is published only after model verification and a nonempty Markdown/JSON PDF test',async()=>{
 const {installMineru}=await import(installerUrl);const workspace=await mkdtemp(join(tmpdir(),'mineru-mac-ready-')),root=join(workspace,'processor');const stages:string[]=[];
 try{
  await installMineru({workspace,root,source:'modelscope'},async(command:string,args:string[],env:Record<string,string>)=>{
   stages.push(args.join(' '));assert.ok(!env.MINERU_API_KEY);
   assert.equal(await stat(join(root,'installation.json')).catch(()=>undefined),undefined);
   if(args[0]==='venv'){await mkdir(join(root,'cpu-env','bin'),{recursive:true});await writeFile(join(root,'cpu-env','bin','python'),'');await writeFile(join(root,'cpu-env','bin','mineru-kit'),'');}
   if(args[0]==='parse'){const pdf=await readFile(args[1]);assert.match(pdf.toString(),/^%PDF/);}
   if(args[0]==='-c')await writeFile(join(root,'smoke-test.json'),JSON.stringify({testedAt:new Date().toISOString(),blocks:1,markdownBytes:30,jsonBytes:400}));
  });
  assert.ok(stages.some(s=>s.includes('models verify --tier standard')));assert.ok(stages.some(s=>s.includes('--format zip --pages 1')));
  assert.equal(JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8')).phase,'completed');
  const receipt=JSON.parse(await readFile(join(root,'installation.json'),'utf8'));assert.equal(receipt.standardVerified,true);assert.equal(receipt.tier,'standard');assert.equal(receipt.executable,join(root,'cpu-env','bin','mineru-kit'));
 }finally{await rm(workspace,{recursive:true,force:true});}
});
