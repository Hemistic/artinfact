import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {PortableBoardSchema,portableSource,jsonCanvas,type PortableBoard} from '../whiteboard/board-portable.js';
import {boardDocument,documentAssetIds,replaceDocumentAssets} from '../whiteboard/board-markdown.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import type {WhiteboardPages} from './whiteboard-pages.js';
const digest=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const maxPackage=64*1024*1024;
export class WhiteboardPackages{
 private graph:WorkspaceWhiteboards;
 constructor(private runtime:WorkspaceRuntime,private pages:WhiteboardPages){this.graph=new WorkspaceWhiteboards(runtime);}
 async export(workspaceId:string,boardId:string,name:string,format:'markdown'|'whiteboard'){
  const document=await this.pages.export(workspaceId,boardId,false);if(document.name!==name)throw Error('白板已更改，请刷新结构后重新导出');
  const {board,pages,sources,language,media}=await this.pages.documentContext(workspaceId,boardId),store=await this.graph.store(workspaceId),files:Record<string,Uint8Array>={},paths=new Map<string,string>(),assetRecords:PortableBoard['assets']=[];
  const sourceIds=new Set([...sources.filter(s=>s.cardId&&board.board.nodes.some(n=>n.id===s.cardId)).map(s=>s.id),...board.board.nodes.flatMap(n=>[...(n.sourceId?[n.sourceId]:[]),...(n.citations??[]).map(c=>c.sourceId),...(n.workflow?.result?.citations??[]).map(c=>c.sourceId)])]);
  for(const id of [...sourceIds]){const source=sources.find(s=>s.id===id);if(source?.documentId)sourceIds.add(source.documentId);if(source?.parentSourceId)sourceIds.add(source.parentSourceId);}
  const snapshots=[];if(format==='whiteboard')for(const source of sources.filter(s=>sourceIds.has(s.id))){const text=source.text??(source.markdownPath?await readFile(source.markdownPath,'utf8'):'');const saved=portableSource(source,await media.markdown(text,source));if(!saved.assetId){const node=board.board.nodes.find(n=>n.sourceId===source.id),image=node?documentAssetIds(node.note)[0]:undefined;if(image)saved.assetId=image;else delete saved.assetId;}snapshots.push(saved);}
  const assets=new Set([...document.assets.map(a=>a.id),...media.assets.keys(),...board.board.nodes.flatMap(n=>[...documentAssetIds(n.note),...(n.workflow?.result?[...documentAssetIds(n.workflow.result.markdown),...(n.workflow.result.imageAssetId?[n.workflow.result.imageAssetId]:[])]:[])])]);
  for(const source of snapshots)if(source.assetId&&!assets.has(source.assetId)){const node=board.board.nodes.find(n=>n.sourceId===source.id),image=node?documentAssetIds(node.note)[0]:undefined;if(image)source.assetId=image;else delete source.assetId;}
  for(const id of assets){const asset=media.assets.get(id)??await store.assetRead(id),bytes=Buffer.from(asset.base64,'base64'),sha256=digest(bytes),ext=asset.mimeType==='image/jpeg'?'jpg':asset.mimeType.split('/')[1],path='assets/'+sha256+'.'+ext;files[path]=bytes;paths.set(id,path);assetRecords.push({id,name:asset.name,mimeType:asset.mimeType as PortableBoard['assets'][number]['mimeType'],path,bytes:bytes.length,sha256});}
  files['document.md']=strToU8(replaceDocumentAssets(document.markdown,paths));
  let primary='document.md';
  if(format==='whiteboard'){
   const content=new Map<string,string>();for(const [index,node]of board.board.nodes.entries()){
    const single=boardDocument({...board,title:node.title,board:{version:1,nodes:[{...node,groupId:undefined}],edges:[]}},new Map(pages.has(node.id)?[[node.id,pages.get(node.id)!]]:[]),{sources,language}).markdown,anchor='<a id="card-1"></a>',card=single.slice(single.indexOf(anchor)+anchor.length).trim().replace(/^### /,'# '),portable=replaceDocumentAssets(card,paths);content.set(node.id,portable);files['cards/card-'+(index+1)+'.md']=strToU8(replaceDocumentAssets(card,new Map([...paths].map(([id,path])=>[id,'../'+path]))));
   }
   files['whiteboard.canvas']=strToU8(JSON.stringify(jsonCanvas(board,content),null,2)+'\n');
   const saved=PortableBoardSchema.parse({format:'artinfact-whiteboard',version:1,title:board.title,board:{...board,tasks:[]},sources:snapshots,pages:[...pages].map(([nodeId,page])=>({nodeId,syncedAt:page.syncedAt,page:{pageId:page.pageId,url:page.url,title:page.title,blocks:page.blocks,...(page.sequence!==undefined?{sequence:page.sequence}:{})}})),assets:assetRecords});
   files['whiteboard.json']=strToU8(JSON.stringify(saved));primary='whiteboard.canvas';
  }
  const instructions=language==='en'?'# Whiteboard export\n\nOpen document.md together with assets/. The editable whiteboard.canvas follows JSON Canvas 1.0; copy the complete folder into a compatible plugin or vault. Open the .artinfact package in Artinfact via + → Import local files to create an independent editable board. whiteboard.json preserves native card types, full notes, evidence, highlights, source text and Pages snapshots. Tasks are not resumed. Original PDFs are not included; opening a PDF requires its original workspace. External URLs remain links.\n':'# 白板导出包\n\ndocument.md 是按分区与输入连线组装的完整 Markdown，assets/ 是对应图片。移动文档时请一起移动 assets/。\n\nwhiteboard.canvas 使用 JSON Canvas 1.0；将完整目录复制到支持该格式的插件或笔记库后打开。\n\n.artinfact 是 ZIP 结构的可编辑白板包，在 Artinfact 的＋ → 导入本地文件中打开，会创建独立白板。whiteboard.json 保存卡片类型、完整笔记、证据高亮、来源文本和 Pages 快照。任务不会自动恢复执行。原 PDF 文件不打入包中，跳转 PDF 需要原工作区；外部网址仍保留为链接。\n';
  files['README.md']=strToU8(instructions);
  files['manifest.json']=strToU8(JSON.stringify({format:format==='whiteboard'?'artinfact-whiteboard':'artinfact-markdown',version:1,title:board.title,createdAt:new Date().toISOString(),files:Object.entries(files).map(([path,data])=>({path,bytes:data.length,sha256:digest(data)}))},null,2)+'\n');
  if((await this.pages.export(workspaceId,boardId,false)).name!==name)throw Error('白板在打包时已更改，请重新导出');
  const bytes=zipSync(files,{level:1});if(format==='whiteboard'&&bytes.length>maxPackage)throw Error('白板包超过 64 MB，请拆分为多个白板导出');
  const base=await realpath(this.runtime.library.baseDirectory()),parent=join(base,'exports',workspaceId);await mkdir(parent,{recursive:true});const canonical=await realpath(parent),rel=relative(base,canonical);if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('导出目录超出资料库边界');const directory=await mkdtemp(join(canonical,'package-'));await mkdir(join(directory,'assets')); 
  for(const [path,data]of Object.entries(files)){const target=join(directory,...path.split('/'));await mkdir(join(target,'..'),{recursive:true});await writeFile(target,data,{flag:'wx',mode:0o600});}
  const archivePath=join(directory,format==='whiteboard'?'whiteboard.artinfact':'markdown-resources.zip');await writeFile(archivePath,bytes,{flag:'wx',mode:0o600});if(digest(await readFile(archivePath))!==digest(bytes))throw Error('导出包写入后校验失败');
  return{title:board.title,format,path:join(directory,primary),archivePath,resourcesPath:join(directory,'assets'),bytes:bytes.length,sha256:digest(bytes),counts:document.counts};
 }
 async import(workspaceId:string,input:{name:string;base64:string;expectedRevision:number;requestId:string}){
  if(!/\.artinfact$/i.test(input.name))throw Error('请选择 .artinfact 可编辑白板包');const bytes=Buffer.from(input.base64,'base64');if(!bytes.length||bytes.length>maxPackage||bytes.toString('base64')!==input.base64)throw Error('白板包编码无效或超过 64 MB');
  let total=0,count=0;const names=new Set<string>();const files=unzipSync(bytes,{filter:file=>{if(names.has(file.name)||! /^(?:manifest\.json|whiteboard\.(?:json|canvas)|document\.md|README\.md|assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif|avif|bmp)|cards\/card-[0-9]+\.md)$/.test(file.name))throw Error('白板包文件名无效');names.add(file.name);if(++count>6000||(total+=file.originalSize)>128*1024*1024||file.originalSize>64*1024*1024||/\\|(^|\/)\.\.?($|\/)|^\/|^[A-Za-z]:/.test(file.name))throw Error('白板包目录或解压大小无效');return true;}});
  if(!files['whiteboard.json']||!files['manifest.json'])throw Error('白板包缺少格式信息');const manifest=JSON.parse(strFromU8(files['manifest.json']));if(manifest.format!=='artinfact-whiteboard'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>6000)throw Error('不支持此白板包版本');
  const listed=new Set<string>();for(const entry of manifest.files){if(typeof entry.path!=='string'||listed.has(entry.path)||!files[entry.path]||files[entry.path].length!==entry.bytes||digest(files[entry.path])!==entry.sha256)throw Error('白板包文件校验失败');listed.add(entry.path);}if(!listed.has('whiteboard.json'))throw Error('白板包缺少可校验的正文');
  const saved=PortableBoardSchema.parse(JSON.parse(strFromU8(files['whiteboard.json']))),store=await this.graph.store(workspaceId),assetIds:Record<string,string>={};
  const known=new Set(saved.assets.map(a=>a.id));for(const node of saved.board.board.nodes){const required=[...documentAssetIds(node.note),...(node.workflow?.result?[...documentAssetIds(node.workflow.result.markdown),...(node.workflow.result.imageAssetId?[node.workflow.result.imageAssetId]:[])]:[])];if(required.some(id=>!known.has(id)))throw Error('白板包缺少卡片图片');}
  if((await store.list()).revision!==input.expectedRevision)throw Error('REVISION_CONFLICT: 白板已更新，请重试');
  for(const asset of saved.assets){const data=files[asset.path];if(!listed.has(asset.path)||!data||data.length!==asset.bytes||digest(data)!==asset.sha256)throw Error('白板包图片校验失败');const result=await store.assetPut({name:asset.name,mimeType:asset.mimeType,base64:Buffer.from(data).toString('base64')});assetIds[asset.id]=result.id;}
  return store.restorePortable({expectedRevision:input.expectedRevision,requestId:input.requestId,package:saved,assetIds});
 }
}
