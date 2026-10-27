import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile} from 'node:fs/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.error)throw result.error;if(result.status)throw Error(result.stderr.trim());return result.stdout.trim();}
try{
 const [command='status',...args]=process.argv.slice(2),workingVersion=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version,commit=git(['rev-parse','HEAD']),version=JSON.parse(git(['show',commit+':package.json'])).version,branch=git(['symbolic-ref','--short','HEAD']),changes=git(['status','--porcelain','--untracked-files=no']);
 if(command==='status')process.stdout.write(JSON.stringify({version,workingVersion,branch,commit,clean:!changes},null,2)+'\n');
 else if(command==='bundle'){
  // A bundle contains committed objects only, so other ongoing edits can safely remain in the checkout.
  if(args[0]!=='--output'||args.length!==2)throw Error('Use bundle --output <file.bundle>');const output=resolve(args[1]);await mkdir(dirname(output),{recursive:true});git(['bundle','create',output,branch,'HEAD']);git(['bundle','verify',output]);process.stdout.write(JSON.stringify({version,commit,branch,bundle:output,workingTreeDirty:!!changes,includesUncommittedChanges:false},null,2)+'\n');
 }else throw Error('Use status or bundle --output <file.bundle>');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
