import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {packagePlatform} from './package-platform.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('This release packager currently targets Windows x64.');
const readJson=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const manifest=await readJson('plugin.json'),pkg=await readJson('package.json'),compat=await readJson('.codex-plugin/plugin.json');
if(manifest.name!=='codex-work-layout'||pkg.version!==manifest.version||compat.version!==manifest.version)throw Error('Plugin identity or versions do not match.');
const platform=packagePlatform();
const required=[...platform.required,'dist/server/index.js','dist/ui/index.html','dist/ui/pdf.html','dist/whiteboard/index.html','vendor/research/runtime/wiki.cjs','vendor/zotero-reader/runtime/reader-local.html','vendor/zotero-reader/source/reader/src/pdf/pdf-view.js','vendor/zotero-reader/source/reader/package.json','vendor/zotero-reader/COPYING','vendor/pdf-worker/COPYING','src/server/index.ts','README.md','LICENSE','NOTICE.md',...['pages-preview','pdf-reader','pdfai-context','wiki-ingest','wiki-init','wiki-lint','wiki-query','wiki-save','work-layout'].map(name=>`skills/${name}/SKILL.md`)];
for(const name of required)if(!(await fs.stat(path.join(root,name))).isFile())throw Error('Missing runtime/source file: '+name);
const archiveRoot=`artinfact-${pkg.version}-windows-x64`;
const prefix=`${archiveRoot}/plugins/${manifest.name}/`;
const entries={},inventory=[];
const excluded=new Set(['.git','.context','.preview-data','__pycache__']);
async function collect(relative){
 if(!platform.include(relative)||relative.split('/').some(part=>excluded.has(part)))return;
 if(relative.split('/').includes('node_modules')&&!relative.startsWith('vendor/mineru/runtime/node_modules'))return;
 const absolute=path.join(root,relative),info=await fs.lstat(absolute);
 if(info.isSymbolicLink())throw Error('Refusing linked package content: '+relative);
 if(info.isDirectory()){for(const name of (await fs.readdir(absolute)).sort())await collect(relative+'/'+name);return;}
 if(/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.log)$/.test(relative)||/\.(?:tmp|pyc)$/.test(relative))throw Error('Unexpected private/generated file: '+relative);
 const bytes=await fs.readFile(absolute);entries[prefix+relative]=bytes;
 inventory.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const name of ['.codex-plugin','assets','dist','docs','scripts','skills','src','tests','vendor','review-fixtures','third-party-licenses','LICENSE','NOTICE.md','SOURCE-BUNDLE.md','README.md','package.json','package-lock.json','plugin.json','mcp.json','.mcp.json','tsconfig.json'])await collect(name);
const marketplace={name:'artinfact-local',interface:{displayName:'Artinfact Local'},plugins:[{name:manifest.name,source:{source:'local',path:`./plugins/${manifest.name}`},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]};
entries[`${archiveRoot}/.agents/plugins/marketplace.json`]=strToU8(JSON.stringify(marketplace,null,2)+'\n');
entries[`${archiveRoot}/INSTALL.md`]=strToU8(await fs.readFile(path.join(root,'docs/INSTALL.md'),'utf8'));
entries[`${archiveRoot}/package-inventory.json`]=strToU8(JSON.stringify({version:pkg.version,platform:'win32-x64',files:inventory},null,2)+'\n');
const zip=zipSync(entries,{level:6});
if(zip.length>=100*1024*1024)throw Error('Release exceeds 100 MiB.');
const restored=unzipSync(zip);
for(const [name,bytes] of Object.entries(entries))if(!Buffer.from(restored[name]??[]).equals(Buffer.from(bytes)))throw Error('Archive round-trip mismatch: '+name);
const output=path.join(root,'releases');await fs.mkdir(output,{recursive:true});
const filename=archiveRoot+'.zip',sha256=createHash('sha256').update(zip).digest('hex');
await fs.writeFile(path.join(output,filename),zip);
await fs.writeFile(path.join(output,filename+'.sha256'),`${sha256}  ${filename}\n`);
console.log(JSON.stringify({file:path.join(output,filename),sha256,bytes:zip.length,files:Object.keys(entries).length},null,2));

