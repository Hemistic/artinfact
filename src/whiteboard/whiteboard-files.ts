import {mkdir,readFile,writeFile,link,unlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Source} from './whiteboard-domain.js';
type Imported={id:string;name:string;format:'pdf'|'md';ready:boolean};
const filePath=(root:string,item:Imported)=>join(root,'imports',item.id,item.format==='md'?'source.md':'document.pdf');
export async function importedSources(root:string):Promise<Source[]>{
 let directories;try{directories=await readdir(join(root,'imports'),{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 const sources:Source[]=[];for(const entry of directories){if(!entry.isDirectory()||!/^file-[a-f0-9]{64}$/.test(entry.name))continue;let item:Imported;try{item=JSON.parse(await readFile(join(root,'imports',entry.name,'metadata.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
  if(item.id!==entry.name||typeof item.name!=='string'||!['md','pdf'].includes(item.format))throw new Error('IMPORT_CORRUPT');const path=filePath(root,item);sources.push({id:item.id,name:item.name,format:item.format,path,...(item.format==='md'?{markdownPath:path,category:'markdown' as const}:{})});
 }return sources;
}
export async function importDocument(root:string,args:{name:string;base64:string}):Promise<Imported>{
 const extension=/\.(pdf|md|markdown)$/i.exec(args.name)?.[1].toLowerCase();if(!extension)throw new Error('FILE_TYPE: 请选择 PDF 或 Markdown');
 if(args.base64.length%4||/[^A-Za-z0-9+/=]/.test(args.base64))throw new Error('FILE_ENCODING');
 const bytes=Buffer.from(args.base64,'base64');if(bytes.toString('base64')!==args.base64)throw new Error('FILE_ENCODING');if(!bytes.length||bytes.length>20*1024*1024)throw new Error('FILE_SIZE: 文件应在 20 MB 以内');
 const format=extension==='pdf'?'pdf':'md';if(format==='pdf'&&!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('PDF_INVALID: 文件不是 PDF');
 if(format==='md')try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('FILE_UTF8: Markdown 需要 UTF-8 编码');}
 const id='file-'+createHash('sha256').update(format).update(bytes).digest('hex'),folder=join(root,'imports',id);await mkdir(folder,{recursive:true});
 const item:Imported={id,name:args.name.replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').slice(0,240),format,ready:format==='md'};
 const save=async(target:string,data:Buffer|string)=>{const temporary=join(folder,randomUUID()+'.tmp');try{await writeFile(temporary,data,{flag:'wx',mode:0o600});try{await link(temporary,target);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}finally{await unlink(temporary).catch(()=>{});}};
 await save(filePath(root,item),bytes);await save(join(folder,'metadata.json'),JSON.stringify(item));return JSON.parse(await readFile(join(folder,'metadata.json'),'utf8'));
}
