import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
const retired=JSON.parse(await readFile('scripts/removed-markdown-files.json','utf8'));
const root='codex-work-layout/'; const wanted=new Set(retired.map(p=>root+p));
const old=unzipSync(await readFile('../codex-work-layout-0.9.9-source.zip'),{filter:file=>wanted.has(file.name)});
const files=[];
for(const path of retired) {
 const prior=old[root+path]; if(!prior)throw Error('Missing baseline file: '+path);
 let localExists;try{await stat(resolve(path));localExists=true;}catch(error){if(error.code!=='ENOENT')throw error;localExists=false;}
 if(localExists)throw Error('Retired file remains in source: '+path);
 const authored=/^(?:src\/|scripts\/|vendor\/markdown-editor\/source\/src\/)/.test(path)&&/\.(ts|tsx|css|mjs)$/.test(path);
 files.push({path,previousBytes:prior.length,sourceLines:authored?Buffer.from(prior).toString('utf8').split(/\r?\n/).length:0,localStatus:'deleted'});
}
const pkg=JSON.parse(await readFile('package.json','utf8'));
const deps=[...Object.keys(pkg.dependencies||{}),...Object.keys(pkg.devDependencies||{})];
if(deps.some(d=>/^@milkdown\/|^prosemirror-|^mermaid$/.test(d)))throw Error('Retired editor dependency remains');
const shell=await readFile('src/ui/workspace-shell.ts','utf8'),css=await readFile('src/ui/workspace-shell.css','utf8'),links=await readFile('src/ui/pages-links.ts','utf8'),pdf=await readFile('src/ui/pdf.ts','utf8');
if(/saveNote|hooks\.(?:download|openLink|navigatePage)|workspace-page-excerpt/.test(shell))throw Error('Retired editor hooks remain');
if(/--aif-(?:code-|mermaid-|syntax-mark-|inline-code|table-)/.test(css))throw Error('Retired editor colors remain');
if(/pagesExcerpt|note-excerpt|\.innerHTML\s*=/.test(links))throw Error('Pages body renderer remains');
if(/workspaceShell\.saveNote/.test(pdf))throw Error('Retired lifecycle save remains');
async function scanSource(folder) {
 for(const entry of await readdir(folder,{withFileTypes:true})) {
  const path=folder+'/'+entry.name;
  if(entry.isDirectory())await scanSource(path);
  else if(/\.(ts|tsx|css|html)$/.test(path)&&/\bMilkdown\b|@milkdown\/|\bProseMirror\b|markdown-editor|workspace-markdown-frame|__artinfactMarkdown|Markdown 快照编辑器/.test(await readFile(path,'utf8')))throw Error('Retired editor signature remains: '+path);
 }
}
await scanSource('src');
const report={baseline:'0.9.9 complete source archive',version:pkg.version,deletedFiles:files.length,deletedAuthoredSourceLines:files.reduce((n,f)=>n+f.sourceLines,0),removedBytes:files.reduce((n,f)=>n+f.previousBytes,0),removedRuntimeBytes:files.filter(f=>f.path.includes('/runtime/')).reduce((n,f)=>n+f.previousBytes,0),additionalCleanup:{obsoleteCssDeclarations:50,externalImageOrigins:6,legacyAutosaveHooks:'removed',oldEditorDownloadAndLinkHooks:'removed',appPagesRead:'metadata only, no body or excerpt'},preserved:['MinerU Markdown for Wiki/graph evidence','local note import and PDF evidence storage','Pages associations and authenticated sync records','existing user notes and image assets'],files};
await writeFile('docs/markdown-cleanup-audit.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({...report,files:undefined})+'\n');
