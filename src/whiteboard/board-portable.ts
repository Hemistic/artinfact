import {z} from 'zod';
import {BoardDataSchema,type BoardData,type Source} from './whiteboard-domain.js';
import {WorkflowPage} from './workflow.js';
import {flowNodeSize} from './editable-flow-model.js';
import {encloseRegionCards} from './region-layout.js';
const location=z.object({start:z.number().int().nonnegative().optional(),end:z.number().int().nonnegative().optional(),quote:z.string().max(100000),context:z.string().max(100000),blockIds:z.array(z.string().max(200)).max(500),pageIndex:z.number().int().nonnegative().optional(),match:z.enum(['matched','unlocated','ambiguous']),candidateCount:z.number().int().nonnegative().optional(),marker:z.object({text:z.string().max(2000),start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).optional()});
export const PortableSourceSchema=z.object({id:z.string().min(1).max(180),name:z.string().max(1000),format:z.enum(['pdf','md']),text:z.string().max(20000000),category:z.enum(['document','section','figure','table','formula','annotation','insight','pages','markdown','reference']).optional(),documentId:z.string().max(180).optional(),parentSourceId:z.string().max(180).optional(),page:z.number().int().positive().optional(),assetId:z.string().max(180).optional(),cardId:z.string().max(180).optional(),latex:z.string().max(120000).optional(),caption:z.string().max(120000).optional(),bibliography:z.object({raw:z.string().max(100000),title:z.string().max(2000).optional(),number:z.string().max(200).optional(),authorKey:z.string().max(2000).optional(),year:z.string().max(30).optional(),doi:z.string().max(2000).optional(),url:z.string().max(4000).optional(),entry:location,occurrences:z.array(location).max(10000)}).optional()}).strict();
export type PortableSource=z.infer<typeof PortableSourceSchema>;
export const PortableBoardSchema=z.object({format:z.literal('artinfact-whiteboard'),version:z.literal(1),title:z.string().min(1).max(160),board:BoardDataSchema,sources:z.array(PortableSourceSchema).max(4000),pages:z.array(z.object({nodeId:z.string().max(180),page:WorkflowPage,syncedAt:z.string().optional()})).max(1000),assets:z.array(z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,180}$/),name:z.string().max(1000),mimeType:z.enum(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp']),path:z.string().regex(/^assets\/[a-f0-9]{64}\.(png|jpg|webp|gif|avif|bmp)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(20*1024*1024)})).max(4000)}).strict();
export type PortableBoard=z.infer<typeof PortableBoardSchema>;
export function portableSource(source:Source,text:string):PortableSource{
 const {id,name,format,category,documentId,parentSourceId,page,assetId,cardId,latex,caption,bibliography}=source;
 return PortableSourceSchema.parse({id,name,format,text,category,documentId,parentSourceId,page,assetId,cardId,latex,caption,bibliography});
}
export function jsonCanvas(board:BoardData,content:Map<string,string>){
 const groupIds=new Map((board.board.groups??[]).filter(g=>!g.id.startsWith('source-')).map((g,i)=>[g.id,'group-'+i]));
 const nodes:Record<string,unknown>[]=[];
 for(const group of board.board.groups??[]){if(!groupIds.has(group.id))continue;const bounds=encloseRegionCards(board.board.nodes.filter(n=>n.groupId===group.id).map(n=>({...n,...flowNodeSize(n)})))??group.bounds??{x:0,y:0,width:320,height:240};nodes.push({id:groupIds.get(group.id),type:'group',label:group.title,color:group.color,...Object.fromEntries(Object.entries(bounds).map(([k,v])=>[k,Math.round(v)]))});}
 const ids=new Map(board.board.nodes.map((n,i)=>[n.id,'card-'+i]));
 for(const node of board.board.nodes){const size=flowNodeSize(node);nodes.push({id:ids.get(node.id),type:'text',x:Math.round(node.x),y:Math.round(node.y),width:Math.round(size.width),height:Math.round(size.height),text:content.get(node.id)??node.note});}
 const edges=board.board.edges.map((edge,i)=>({id:'edge-'+i,fromNode:ids.get(edge.source)!,toNode:ids.get(edge.target)!,fromEnd:'none',toEnd:edge.kind==='context'?'none':'arrow',...(edge.sourceSide?{fromSide:edge.sourceSide}:{}),...(edge.targetSide?{toSide:edge.targetSide}:{}),...(edge.label.trim()?{label:edge.label}:{})}));
 return{nodes,edges};
}
