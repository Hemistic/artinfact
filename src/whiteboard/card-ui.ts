import type {BoardNode,Board} from './whiteboard-domain.js';

export function cardUiState(node:BoardNode,pageLinked:boolean,task?:{status:string;message:string}){
 const running=!!task&&['queued','running'].includes(task.status);
 const run=node.workflow?{label:running?(task!.status==='running'?'运行中':'等待 Agent'):node.workflow.result?'重新运行':'运行',disabled:running}:undefined;
 return {
  actions:[...(pageLinked?['pages' as const]:[]),...(run?['run' as const]:[])],run,
  basisLabel:node.basis==='hypothesis'?'待验证':node.basis==='inference'?'推断':'',
  error:task?.status==='failed'?task.message:undefined
 };
}

export function inspectorRelations(node:BoardNode,edges:Board['edges']){
 return edges.filter(edge=>(edge.source===node.id||edge.target===node.id)&&!(node.workflow&&edge.target===node.id&&edge.kind!=='context'));
}
