import {mineruLayoutRuntime} from './retained-runtimes.js';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {evidenceCandidates,evidenceLink,evidenceText,mineruEvidenceBlocks,type EvidenceDocument,type PdfEvidence} from '../shared/pdf-evidence.js';
import type {WorkspaceRuntime} from './workspace-runtime.js';
import {ResearchWiki} from './research-wiki.js';
import {WorkspaceWhiteboards} from './whiteboard-service.js';
import {isolatedPdfTask} from './pdf-process.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export class PdfEvidenceService{
 constructor(private runtime:WorkspaceRuntime){}
 private async document(workspaceId:string,documentId:string):Promise<EvidenceDocument>{
  const doc=await this.runtime.library.document(workspaceId,documentId),result=await(await this.runtime.scope(workspaceId,documentId)).mineru.result(documentId);
  if(result.format==='markdown-only')throw Error('此文献仍是旧的轻量 Markdown；请先用本机 MinerU 标准版解析布局，生成同源 JSON 后定位原句。');
  const jsonPath=join(result.directory,'document-mineru.json');if((await stat(jsonPath)).size>100*1024*1024)throw Error('MinerU JSON 超过读取上限');
  const json=await readFile(jsonPath,'utf8');
  return {documentId,title:doc.title||doc.name,jsonHash:hash(json),markdown:await readFile(join(result.directory,'document-mineru.md'),'utf8'),blocks:mineruEvidenceBlocks(JSON.parse(json))};
 }
 async locations(workspaceId:string,target:{nodePath?:string;boardId?:string;nodeId?:string;citationIndex?:number;referenceIndex?:number;referenceRevision?:string}){
  let text='',documentIds:string[]=[];
  if(target.nodePath){
   const wiki=new ResearchWiki(this.runtime.library,this.runtime),page=await wiki.read(workspaceId,target.nodePath),graph=await wiki.graph(workspaceId,false);text=page.text;
   const pageInfo=graph.pages.find((p:any)=>p.relativePath===target.nodePath);if(!pageInfo)throw Error('图谱节点不存在');
   // Only direct literature links and declared sources can supply this node's evidence.
   const related=new Set([target.nodePath]);for(const e of graph.edges)if(e.source===target.nodePath)related.add(e.target);else if(e.target===target.nodePath)related.add(e.source);
   documentIds=graph.documents.filter((d:any)=>related.has(`wiki/sources/${d.documentId}.md`)||related.has(d.markdownPath)||pageInfo.sources.includes(d.markdownPath)).map((d:any)=>d.documentId);
   for(const match of text.matchAll(/artinfact-pdf:\/\/([a-f0-9]{64})\//g))documentIds.push(match[1]);
  }else{
   const service=new WorkspaceWhiteboards(this.runtime),view=await(await service.store(workspaceId)).read(target.boardId!),node=view.board?.board.nodes.find(n=>n.id===target.nodeId);if(!node)throw Error('白板节点不存在');
   const sources=await service.sources(workspaceId);
   if(target.referenceIndex!==undefined){const source=sources.find(s=>s.id===node.sourceId),reference=source?.bibliography;if(!reference||!source?.documentId)throw Error('此卡片没有引用文献定位信息');if(target.referenceRevision&&target.referenceRevision!==hash(JSON.stringify(reference)))throw Error('引用列表已更新，请重新打开卡片');const location=target.referenceIndex===-1?reference.entry:reference.occurrences[target.referenceIndex];if(!location)throw Error('引用位置不存在，请重新打开卡片');if(location.match!=='matched')throw Error(location.match==='ambiguous'?'同作者同年份引用尚有歧义，请先核对文献信息':'尚未找到与同源 Markdown 一致的 JSON 定位');documentIds.push(source.documentId);text=location.blockIds.map(id=>evidenceLink(source.documentId!,id,location.quote)).join('\n');}
   const citations=[...(node.citations??[]),...(node.workflow?.result?.citations??[])];
   if(target.citationIndex!==undefined&&(!Number.isInteger(target.citationIndex)||target.citationIndex<0||target.citationIndex>=citations.length))throw Error('所选原文证据不存在，请重新打开卡片');
   for(const citation of target.referenceIndex!==undefined?[]:target.citationIndex===undefined?citations:[citations[target.citationIndex]]){const source=sources.find(s=>s.id===citation.sourceId);if(!source?.documentId||source.text?.slice(citation.start,citation.end)!==citation.quote)continue;documentIds.push(source.documentId);text+='\n\n> '+citation.quote.replace(/\n/g,'\n> ');}
   // Automatic source cards may not yet have a user note; still validate their original text.
   if(!text&&target.citationIndex===undefined&&node.sourceId){const source=sources.find(s=>s.id===node.sourceId);if(source?.documentId){documentIds.push(source.documentId);text=[node.note,source.text??source.caption??''].join('\n\n');}}
  }
  const documents:EvidenceDocument[]=[],warnings:string[]=[];
  for(const id of [...new Set(documentIds)].slice(0,40)){try{documents.push(await this.document(workspaceId,id));}catch(e){warnings.push(String((e as Error).message));}}
  const locations=evidenceCandidates(text,documents);
  return {locations,warnings,message:locations.length?'请选择要回查的 PDF 原句':'此节点没有可核实的原句引用；生成节点时需保留同源 Markdown 原句与 MinerU blockId。'};
 }
 async locate(workspaceId:string,evidence:PdfEvidence){
  const doc=await this.document(workspaceId,evidence.documentId);if(doc.jsonHash!==evidence.jsonHash)throw Error('MinerU 结果已更新，请重新点击图谱节点');
  const validated=evidenceCandidates(evidenceLink(evidence.documentId,evidence.blockId,evidence.quote),[doc])[0];if(!validated||validated.pageIndex!==evidence.pageIndex)throw Error('原句与 MinerU 来源不一致');
  const source=await this.runtime.library.document(workspaceId,evidence.documentId);
  const result=await(await this.runtime.scope(workspaceId,evidence.documentId)).mineru.result(evidence.documentId),block=doc.blocks.find(b=>b.id===validated.blockId)!;
  const needle=evidenceText(validated.quote),outsideBbox=!!block.outsideBboxText&&evidenceText(block.outsideBboxText).includes(needle);
  const sourceRect=result.coordinateSpace&&!outsideBbox?mineruLayoutRuntime().mapContentListRectToPdfRect(block.bbox,result.pages[block.pageIndex],result.coordinateSpace,block.pageIndex):undefined;
  if(!sourceRect&&doc.blocks.filter(b=>b.pageIndex===block.pageIndex&&evidenceText(b.text).includes(needle)).length>1)throw Error('同页存在多处相同原句，缺少原句坐标，无法消除定位歧义');
  const {value}=await isolatedPdfTask(new URL('./pdf-evidence-worker.js',import.meta.url),{path:source.sourcePath,pageIndex:validated.pageIndex,quote:validated.quote,sourceRect},60000);
  const position=value;
  if(!position?.rects?.length)throw Error('此原句在 PDF 文本层中无法精确定位，可能为扫描件或 OCR 与原文不一致；未使用段落框冒充句子高亮。');
  if(position.rects.some((r:any)=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)))throw Error('PDF 原句坐标无效');
  // Never store a search flash as a persistent annotation.
  return {...validated,pageIndex:position.pageIndex,position:{pageIndex:position.pageIndex,rects:position.rects}};
 }
}
