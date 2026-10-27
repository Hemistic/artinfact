import {cardContent,type BoardView,type Operation} from './whiteboard-domain.js';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const conflict=()=>{throw new Error('VERSION_CHANGED: 这部分内容已被更新，当前草稿已保留，请先核对新版本。');};
function merge(old:Record<string,unknown>|undefined,current:Record<string,unknown>|undefined,proposed:Record<string,unknown>){
 if(!old){if(current&&!equal(current,proposed))conflict();return proposed;}
 if(!current)return conflict();const result={...current};
 for(const key of new Set([...Object.keys(old),...Object.keys(proposed)])){
  if(equal(old[key],proposed[key]))continue;
  if(!equal(old[key],current[key])&&!equal(current[key],proposed[key]))conflict();
  if(key in proposed)result[key]=proposed[key];else delete result[key];
 }
 return result;
}
export function rebaseBoardOperations(old:BoardView,current:BoardView,operations:Operation[]):Operation[]{
 return operations.map(op=>{
  if(op.op==='put_node'){const a=old.board?.board.nodes.find(n=>n.id===op.node.id),b=current.board?.board.nodes.find(n=>n.id===op.node.id);return{op:'put_node',node:merge(a,b,op.node) as typeof op.node};}
  if(op.op==='remove_node'){const a=old.board?.board.nodes.find(n=>n.id===op.id),b=current.board?.board.nodes.find(n=>n.id===op.id);if(a&&b&&!equal(cardContent(a),cardContent(b)))conflict();return op;}
  if(op.op==='put_edge')return{op:'put_edge',edge:merge(old.board?.board.edges.find(e=>e.id===op.edge.id),current.board?.board.edges.find(e=>e.id===op.edge.id),op.edge) as typeof op.edge};
  if(op.op==='remove_edge'){if(!equal(old.board?.board.edges.find(e=>e.id===op.id),current.board?.board.edges.find(e=>e.id===op.id)))conflict();return op;}
  if(op.op==='put_group')return{op:'put_group',group:merge(old.board?.board.groups?.find(g=>g.id===op.group.id),current.board?.board.groups?.find(g=>g.id===op.group.id),op.group) as typeof op.group};
  if(op.op==='remove_group'){if(!equal(old.board?.board.groups?.find(g=>g.id===op.id),current.board?.board.groups?.find(g=>g.id===op.id)))conflict();return op;}
  if(op.op==='rename'&&old.board?.title!==current.board?.title&&op.title!==current.board?.title)conflict();return op;
 });
}
