import type {Board,BoardNode,Source} from './whiteboard-domain.js';
export const PaperPanorama={id:'paper-panorama',name:'论文全景',description:'全文 → 章节 → 图表、公式、批注与洞察；保留真实归属和正文引用。'} as const;
export function sourceNote(source:Source){
 const body=source.latex?'$$\n'+source.latex.replace(/^\s*\$\$?|\$\$?\s*$/g,'').trim()+'\n$$':source.text?.slice(0,12000)??'Workspace 信源';
 return body+'\n\n'+(source.page?'PDF 第 '+source.page+' 页\n\n':'')+(source.markdownPath||source.text!==undefined?'原文资料已准备；可自行记笔记，或主动调用 AI。':'正文待解析；请先在 Workspace 转换 Markdown。');
}
export function paperPanorama(sources:Source[],documentId:string,shared:BoardNode[]=[]):Board{
 const document=sources.find(s=>s.id===documentId&&s.format==='pdf'&&(s.category??'document')==='document');
 if(!document)throw Error('PAPER_REQUIRED: 请选择 Workspace 的 PDF 全文');
 if(!document.markdownPath&&document.text===undefined)throw Error('SOURCE_NOT_PARSED: 请先解析此 PDF，再生成论文全景');
 const items=[document,...sources.filter(s=>s.id!==document.id&&s.documentId===document.id&&s.category!=='reference')],ids=new Set(items.map(s=>s.id));
 if(items.length>500)throw Error('PANORAMA_LIMIT: 本文超过 500 张卡片，请按章节拆分');
 const board:Board={version:1,nodes:[],edges:[]},byId=new Map(items.map(s=>[s.id,s])),placed=new Set<string>();
 let row=0;
 const nodeId=(id:string)=>'source-'+id;
 const visit=(source:Source,depth:number)=>{
  if(placed.has(source.id))return;placed.add(source.id);
  const children=items.filter(s=>s.id!==source.id&&(ids.has(s.parentSourceId??'')?s.parentSourceId:document.id)===source.id);
  const start=row;
  if(!children.length)row++;
  for(const child of children)visit(child,Math.min(depth+1,7));
  const saved=shared.find(n=>n.id===nodeId(source.id));
  board.nodes.push({id:nodeId(source.id),title:source.name.slice(0,240),note:sourceNote(source),kind:'note',role:'source',sourceId:source.id,createdBy:'user',updatedBy:'user',...(saved??{}),x:depth*540+60,y:source.id===document.id?80:(start+(row-start-1)/2)*320+80,width:420,height:260,autoHeight:true});
  for(const child of children)board.edges.push({id:'contains-'+child.id,source:nodeId(source.id),target:nodeId(child.id),label:child.category==='section'?'包含章节':(source.id===document.id?'未定位 · ':'归属 · ')+({figure:'图片',table:'表格',formula:'公式',annotation:'批注',insight:'洞察'}[child.category as 'figure']??'内容'),kind:'context'});
 };
 visit(document,0);
 // Malformed or stale parent metadata cannot make a source silently disappear.
 for(const source of items)if(!placed.has(source.id)){visit(source,1);board.edges.push({id:'unlocated-'+source.id,source:nodeId(document.id),target:nodeId(source.id),label:'未定位内容',kind:'context'});}
 for(const source of items)for(const ref of source.references??[])if(byId.has(ref.sourceId)&&ref.sourceId!==source.id)board.edges.push({id:'ref-'+source.id+'-'+ref.sourceId,source:nodeId(source.id),target:nodeId(ref.sourceId),label:ref.label.slice(0,120),kind:'context'});
 return board;
}
