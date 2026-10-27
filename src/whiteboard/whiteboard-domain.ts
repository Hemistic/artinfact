import { z } from 'zod';
import {WorkflowSchema} from './workflow.js';
import {CardPresentationSchema} from './card-presentation-schema.js';
import {CardActionId} from './card-actions.js';
import type {BibliographyEntry} from '../shared/bibliography.js';
export const Templates=[
 {id:'free',name:'自由笔记',description:'从一张笔记开始，自由组织资料与想法。',color:'#8c95aa',instructions:'按用户的问题整理所选资料；不强制套用论文结构。保留用户笔记。'},
 {id:'contribution',name:'论文贡献与证据',description:'贡献、依据、结果与边界，按实际贡献形成多条分支。',color:'#36b5a5',instructions:'先抓住研究问题与核心机制，再按实际独立贡献建立分支。每个贡献关联原文证据、实验结果及适用边界。保留实验设置、基线和指标；区分作者报告、机制推断、待验证设想。证据可共享，贡献间可依赖或组合，不强制线性链路，不预设贡献数量。'},
 {id:'comparison',name:'跨论文比较',description:'围绕共同问题，比较机制、依据、互补与冲突。',color:'#8a82d9',instructions:'围绕共同研究问题比较所选论文的机制、评估对象、数据和实验口径，连接互补、冲突或依赖。不同实验条件不可直接排名；明确缺失证据。复用已有卡片，支持跨论文多对多联系。'},
 {id:'hypothesis',name:'假设与验证',description:'个人设想、前提、支持与反证、验证方案。',color:'#dda05b',instructions:'以用户设想为研究问题，查找支持、反对及不足以判断的证据。分别记录前提、推理、适用边界、可能失败的条件、验证方案。新颖性未经文献检索不能断言；实验未进行不能生成结果。'}
] as const;
export type Source={id:string;name:string;format:'pdf'|'md';path:string;markdownPath?:string;text?:string;standard?:boolean;structureRevision?:string;category?:'document'|'section'|'figure'|'table'|'formula'|'annotation'|'insight'|'pages'|'markdown'|'reference';bibliography?:BibliographyEntry;documentId?:string;annotationId?:string;page?:number;assetId?:string;cardId?:string;parentSourceId?:string;references?:{sourceId:string;label:string}[];latex?:string;assetPath?:string;caption?:string};
export const SourceCardCategory=z.enum(['section','concept','claim','method','experiment','result','limitation','question']);
export const SourceCardOptions=z.object({mode:z.enum(['semantic','sections']),autoConnect:z.boolean(),question:z.string().max(4000).default('')}).strict();
export const CitationSchema=z.object({sourceId:z.string().min(1).max(180),start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1).max(16000)}).strict();
export const StudyNoteSchema=z.object({label:z.enum(['研读','摘要','创新点','证据','解释']),highlights:z.array(z.object({citation:z.number().int().nonnegative(),text:z.string().min(1).max(8000)}).strict()).max(80)}).strict();
export const NodeSchema=z.object({
 id:z.string().min(1).max(180),title:z.string().min(1).max(240),note:z.string().max(120000),
 kind:z.enum(['question','method','evidence','note','conclusion','image','innovation','inference','validation']),
 x:z.number().min(-200000).max(200000),y:z.number().min(-200000).max(200000),
 width:z.number().min(220).max(1400).optional(),height:z.number().min(152).max(4000).optional(),noteHeight:z.number().min(56).max(4000).optional(),imageHeight:z.number().min(32).max(1600).optional(),autoHeight:z.boolean().optional(),
 groupId:z.string().max(180).optional(),sourceId:z.string().max(180).optional(),sourcePath:z.string().max(4000).optional(),sourceRefs:z.array(z.string().max(4000)).max(40).optional(),
 basis:z.enum(['reported','inference','hypothesis']).optional(),role:z.enum(['source','contribution','evidence','result','limitation','hypothesis','validation','note']).optional(),
 citations:z.array(CitationSchema).max(40).optional(),createdBy:z.enum(['user','agent','import']).optional(),updatedBy:z.enum(['user','agent','import']).optional(),
 studyNote:StudyNoteSchema.optional(),
 referenceCard:z.boolean().optional(),
 presentation:CardPresentationSchema.optional(),workflow:WorkflowSchema.optional(),workflowOrigin:z.object({nodeId:z.string(),taskId:z.string()}).strict().optional(),
 sourceCard:z.object({revision:z.string(),category:SourceCardCategory,taskId:z.string()}).strict().optional()
}).strict();
export const EdgeSchema=z.object({id:z.string().min(1).max(180),source:z.string(),target:z.string(),label:z.string().max(120).default(''),kind:z.enum(['input','context']).optional(),sourceSide:z.enum(['left','right','top','bottom']).optional(),targetSide:z.enum(['left','right','top','bottom']).optional(),suggested:z.boolean().optional()}).strict();
export const GroupSchema=z.object({id:z.string().min(1).max(180),title:z.string().min(1).max(240),color:z.string().regex(/^#[a-f0-9]{6}$/i),description:z.string().max(1000).optional(),opacity:z.number().min(.04).max(.3).optional(),bounds:z.object({x:z.number().min(-200000).max(200000),y:z.number().min(-200000).max(200000),width:z.number().min(120).max(200000),height:z.number().min(120).max(200000)}).strict().optional()}).strict();
export const BoardSchema=z.object({version:z.literal(1),nodes:z.array(NodeSchema).max(1000),edges:z.array(EdgeSchema).max(4000),groups:z.array(GroupSchema).max(100).optional()}).strict().superRefine((b,c)=>{
 const ids=new Set(b.nodes.map(n=>n.id)),groups=new Set(b.groups?.map(g=>g.id));
 if(ids.size!==b.nodes.length||new Set(b.edges.map(e=>e.id)).size!==b.edges.length||groups.size!==(b.groups?.length??0)||b.nodes.some(n=>n.groupId&&!groups.has(n.groupId))||b.edges.some(e=>!ids.has(e.source)||!ids.has(e.target)||e.source===e.target))c.addIssue({code:'custom',message:'BOARD_LINKS: 节点、分组或连接不完整'});
 for(const [index,node]of b.nodes.entries())if(node.studyNote){
  if(node.kind!=='note'||node.sourceId||node.workflow||node.presentation||node.sourcePath||!node.citations?.length)c.addIssue({code:'custom',path:['nodes',index,'studyNote'],message:'STUDY_SOURCE_REQUIRED: 研读笔记必须关联独立原文摘录'});
  if(node.studyNote.highlights.some(h=>!node.citations?.[h.citation]?.quote.includes(h.text)))c.addIssue({code:'custom',path:['nodes',index,'studyNote'],message:'STUDY_HIGHLIGHT: 高亮必须来自对应原文摘录'});
 }
});
export const OperationSchema=z.discriminatedUnion('op',[
 z.object({op:z.literal('put_node'),node:NodeSchema}).strict(),z.object({op:z.literal('remove_node'),id:z.string()}).strict(),
 z.object({op:z.literal('put_edge'),edge:EdgeSchema}).strict(),z.object({op:z.literal('remove_edge'),id:z.string()}).strict(),
 z.object({op:z.literal('put_group'),group:GroupSchema}).strict(),z.object({op:z.literal('remove_group'),id:z.string()}).strict(),
 z.object({op:z.literal('rename'),title:z.string().min(1).max(160)}).strict()
]);
export type BoardNode=z.infer<typeof NodeSchema>;
export type Board=z.infer<typeof BoardSchema>;
export type Operation=z.infer<typeof OperationSchema>;
export const TaskSchema=z.object({id:z.string(),status:z.enum(['queued','running','completed','failed','cancelled']),sourceIds:z.array(z.string()),sourceRevisions:z.record(z.string(),z.string()),instructions:z.string(),message:z.string(),createdAt:z.string(),outputLanguage:z.enum(['zh','en']).optional(),kind:z.enum(['analysis','source_cards','workflow','card_action']).optional(),sourceCards:SourceCardOptions.optional(),nodeId:z.string().optional(),workflowSnapshot:z.string().optional(),cardAction:z.object({action:CardActionId,snapshot:z.string(),output:z.enum(['update','related-note'])}).strict().optional()});
export const BoardDataSchema=z.object({id:z.string(),title:z.string(),templateId:z.enum(['free','contribution','comparison','hypothesis']),sourceIds:z.array(z.string()).max(1000),board:BoardSchema,tasks:z.array(TaskSchema).max(100)});
export type BoardData=z.infer<typeof BoardDataSchema>;
export type BoardView={revision:number;board:BoardData|null;canUndo:boolean;canRedo:boolean;archived?:boolean};
export type Actor='user'|'agent'|'import';
export const MutationFields={expectedRevision:z.number().int().nonnegative(),requestId:z.string().min(1).max(180)};
export function cardContent(n:BoardNode){const {x:_x,y:_y,width:_w,height:_h,noteHeight:_nh,imageHeight:_i,autoHeight:_a,groupId:_g,...content}=n;return content;}
