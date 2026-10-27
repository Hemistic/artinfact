import {z} from 'zod';
import type {Board,BoardNode,Source} from './whiteboard-domain.js';
import {CitationSchema} from './whiteboard-domain.js';
import {cardSnapshot} from './card-actions.js';

const id=z.string().min(1).max(180);
export const ResearchScope=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('article'),documentIds:z.array(id).min(1).max(20)}).strict(),
 z.object({kind:z.literal('region'),boardId:id,groupId:id}).strict(),
 z.object({kind:z.literal('edge'),boardId:id,edgeId:id}).strict()
]);
export const ResearchTask=z.object({id,requestId:id,scope:ResearchScope,status:z.enum(['queued','running','completed','failed','cancelled']),instructions:z.string().min(1).max(8000),preset:z.string().max(80).optional(),outputLanguage:z.enum(['zh','en']),createdAt:z.string(),message:z.string(),snapshot:z.string(),nodeIds:z.array(id),sourceIds:z.array(id),sourceRevisions:z.record(z.string(),z.string()),delivery:z.enum(['sent','draft','manual']).optional(),resultIds:z.array(id).default([])}).strict();
export const ResearchFinding=z.object({title:z.string().trim().min(1).max(240),markdown:z.string().trim().min(1).max(40000),basis:z.enum(['reported','inference','hypothesis']),citations:z.array(CitationSchema).max(40),relatedNodeIds:z.array(id).max(80).default([])}).strict();
export const ResearchResult=z.object({summary:z.string().trim().min(1).max(1800),findings:z.array(ResearchFinding).min(1).max(12)}).strict();
export type WorkbenchScope=z.infer<typeof ResearchScope>;
export type WorkbenchTask=z.infer<typeof ResearchTask>;
export function researchSelection(scope:WorkbenchScope,board?:Board){
 if(scope.kind==='article')return{nodes:[] as BoardNode[],edges:[],snapshot:JSON.stringify([...scope.documentIds].sort())};
 if(!board)throw Error('BOARD_NOT_FOUND');
 const group=scope.kind==='region'?board.groups?.find(g=>g.id===scope.groupId):undefined;
 const edge=scope.kind==='edge'?board.edges.find(e=>e.id===scope.edgeId):undefined;
 if(scope.kind==='region'&&!group||scope.kind==='edge'&&!edge)throw Error('RESEARCH_TARGET_CHANGED: 研究对象已删除');
 const nodes=board.nodes.filter(n=>scope.kind==='region'?n.groupId===scope.groupId:n.id===edge!.source||n.id===edge!.target);
 if(nodes.length<2||nodes.length>80)throw Error('RESEARCH_SCOPE: 请选择 2 至 80 张卡片');
 const ids=new Set(nodes.map(n=>n.id)),edges=edge?[edge]:board.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
 // Geometry is deliberately excluded: moving a card does not invalidate a reading task.
 const snapshot=JSON.stringify({group:group?{id:group.id,title:group.title}:undefined,nodes:nodes.map(n=>[n.id,cardSnapshot(n)]).sort((a,b)=>a[0].localeCompare(b[0])),edges:[...edges].sort((a,b)=>a.id.localeCompare(b.id))});
 return{nodes,edges,snapshot};
}
export function researchSourceIds(scope:WorkbenchScope,nodes:BoardNode[],sources:Source[]){
 const selected=scope.kind==='article'?scope.documentIds:nodes.flatMap(n=>[...(n.sourceId?[n.sourceId]:[]),...(n.citations??[]).map(c=>c.sourceId),...sources.filter(s=>s.cardId===n.id).map(s=>s.id)]);
 return [...new Set(selected.flatMap(id=>{const source=sources.find(s=>s.id===id);return[source?.documentId&&source.documentId!==id?source.documentId:id,id];}))];
}
