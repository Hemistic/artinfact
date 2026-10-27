import type {BoardNode} from './whiteboard-domain.js';
type Source={id:string;name:string;format?:string;category?:string;documentId?:string;page?:number};
type Kind='markdown'|'pages'|'figure'|'table'|'formula'|'annotation'|'insight'|'document'|'section'|'evidence'|'workflow'|'research'|'reference';
const labels:Record<Kind,string>={markdown:'Markdown 笔记',pages:'Pages',figure:'图片',table:'表格',formula:'公式',annotation:'批注',insight:'洞察',document:'PDF 全文',section:'章节',evidence:'证据',workflow:'分析节点',research:'研究卡片',reference:'引用文献'};
export function cardOrigin(node:BoardNode,sources:Source[],page?:{title:string}){
 const source=sources.find(s=>s.id===node.sourceId),own=node.kind==='note'&&!node.sourceId&&!node.workflow&&!node.sourcePath&&!node.presentation&&!node.sourceCard&&!node.workflowOrigin&&node.createdBy!=='agent'&&(!node.role||node.role==='note');
 let kind:Kind='research',label:string|undefined;
 if(node.referenceCard||source?.category==='reference')kind='reference';
 else if(node.presentation?.type==='formula'||source?.category==='formula')kind='formula';
 else if(source?.category==='table')kind='table';
 else if(source?.category==='figure'||node.kind==='image'||node.workflow?.result?.imageAssetId)kind='figure';
 else if(source?.category==='annotation')kind='annotation';
 else if(source?.category==='insight')kind='insight';
 else if(own)kind='markdown';
 else if(node.sourceId?.startsWith('pages-card:')||page&&node.role==='source'||page&&node.workflow?.type==='pages')kind='pages';
 else if(source?.category==='pages')kind='pages';
 else if(source?.category==='markdown'||source?.format==='md'||node.sourceId?.startsWith('md:'))kind='markdown';
 else if(node.workflow?.type==='pages'){kind='pages';label='Pages 输出';}
 else if(node.workflow){kind='workflow';}
 else if(source?.category==='document'||source?.format==='pdf'&&!source.category)kind='document';
 else if(source?.category==='section')kind='section';
 else if(node.presentation?.type==='evidence'||node.kind==='evidence'||node.role==='evidence')kind='evidence';
 const references=[...new Set([...(node.sourceId?[node.sourceId]:[]),...(node.citations??node.workflow?.result?.citations??[]).map(c=>c.sourceId)])].map(id=>sources.find(s=>s.id===id)).filter((s):s is Source=>!!s);
 const provenance=[...new Set(references.map(s=>{const document=sources.find(d=>d.id===s.documentId);return (document?.name||s.name)+(s.page?' · 第 '+s.page+' 页':'');}))];
 let hint=provenance.length?'来源：'+provenance.join('、'):own?'保存在当前白板':node.sourcePath||node.sourceRefs?.length?'来源：工作区 Wiki':node.workflow?'Agent 节点 · '+(node.workflow.result?'已生成':'待生成'):node.sourceId||node.citations?.length?'来源尚未关联':'保存在当前白板';
 if(own&&provenance.length)hint='保存在当前白板 · '+hint;
 if(kind==='pages')hint=page?'来源：Pages · '+page.title:node.workflow?'Pages 输出 · 待生成':hint;
 const linkedPages=!!page&&kind!=='pages';if(linkedPages)hint+=' · 引用 Pages：'+page.title;
 return {kind,label:label??labels[kind],hint,linkedPages};
}
export function originElements(doc:Document,origin:ReturnType<typeof cardOrigin>){
 const header=doc.createElement('div');header.className='wb-card-origin';
 const badge=doc.createElement('span');badge.className='wb-origin-badge';badge.dataset.origin=origin.kind;badge.textContent=origin.label;header.append(badge);
 if(origin.linkedPages){const linked=doc.createElement('span');linked.className='wb-origin-badge';linked.dataset.origin='pages';linked.textContent='Pages';header.append(linked);}
 const footer=doc.createElement('small');footer.className='wb-card-origin-hint';footer.textContent=origin.hint;footer.title=origin.hint;return {header,footer};
}
