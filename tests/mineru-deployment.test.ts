import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveLocalMineruRoot,defaultMineruRoot} from '../src/server/mineru-local.ts';
import {launchMineruDeployment} from '../src/server/mineru-local-setup.ts';

test('processor defaults to the current work directory, supports workspace-local custom paths and follows directory changes',async()=>{
 const w=await mkdtemp(join(tmpdir(),'mineru-workspace-'));const old=process.env.CODEX_MINERU_LOCAL_DIR;delete process.env.CODEX_MINERU_LOCAL_DIR;
 try{assert.equal(await resolveLocalMineruRoot(w),join(w,'processors','mineru'));assert.equal(defaultMineruRoot(w),join(w,'processors','mineru'));
 await mkdir(join(w,'.artinfact'));await writeFile(join(w,'.artinfact','mineru-local.json'),JSON.stringify({version:1,source:'custom',root:join(w,'custom')}));assert.equal(await resolveLocalMineruRoot(w),join(w,'custom'));
 const next=join(w,'new-work');await mkdir(next);assert.equal(await resolveLocalMineruRoot(next),join(next,'processors','mineru'));
 }finally{if(old===undefined)delete process.env.CODEX_MINERU_LOCAL_DIR;else process.env.CODEX_MINERU_LOCAL_DIR=old;await rm(w,{recursive:true,force:true});}
});
test('one-click Windows deployment starts PowerShell, captures early failure and preserves its output',{skip:process.platform!=='win32'},async()=>{
 const w=await mkdtemp(join(tmpdir(),'mineru-deploy-')),root=join(w,'processor with spaces'),script=join(w,'fixture.ps1');
 await writeFile(script,"param([string]$InstallDir,[string]$ModelSource,[string]$WorkspaceDir,[string]$InstallId)\nGet-ExecutionPolicy | Write-Output\nWrite-Output ('SOURCE='+$ModelSource)\nWrite-Output ('WORKSPACE='+$WorkspaceDir)\nWrite-Output 'fixture download failed'\nexit 7\n");
 try{await launchMineruDeployment({root,workspace:w,modelSource:'modelscope',script});let p:any;const deadline=Date.now()+15000;
 do{await new Promise(r=>setTimeout(r,100));p=JSON.parse(await readFile(join(root,'installation-progress.json'),'utf8'));if(Date.now()>deadline)throw new Error('Installer state did not settle');}while(['starting','installing'].includes(p.phase));
 assert.equal(p.phase,'failed');assert.match(p.label,/7/);assert.match(await readFile(p.log,'utf8'),/Bypass/);assert.match(await readFile(p.log,'utf8'),/SOURCE=modelscope/);assert.match(await readFile(p.log,'utf8'),/fixture download failed/);
 }finally{await rm(w,{recursive:true,force:true});}
});
