import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {launchMineruDeployment} from '../src/server/mineru-local-setup.ts';

test('macOS deployment uses the current Node executable, preserves paths and accepts the installer completion receipt',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'mineru-mac-')),root=join(workspace,'processor with spaces'),script=join(workspace,'installer.mjs');
 await writeFile(script,`import {writeFile} from 'node:fs/promises';import {join} from 'node:path';const a=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));await writeFile(join(a['--install-dir'],'arguments.json'),JSON.stringify(a));await writeFile(join(a['--install-dir'],'installation-progress.json'),JSON.stringify({phase:'completed',operationId:a['--install-id'],pid:process.pid}));`);
 try{
  await launchMineruDeployment({root,workspace,modelSource:'huggingface',script,platform:'darwin'});
  let progress:any;const deadline=Date.now()+5000;
  do{await new Promise(r=>setTimeout(r,30));progress=JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8'));assert.ok(Date.now()<deadline);}while(['starting','installing'].includes(progress.phase));
  assert.equal(progress.phase,'completed');
  const args=JSON.parse(await readFile(join(root,'arguments.json'),'utf8'));
  assert.equal(args['--workspace-dir'],workspace);assert.equal(args['--install-dir'],root);assert.equal(args['--model-source'],'huggingface');assert.equal(args['--install-id'],progress.operationId);
 }finally{await rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
