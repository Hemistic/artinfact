import {flowNodeSize,freeFlowPosition,type FlowBoard,type FlowNode} from './editable-flow-model.js';
export function workbenchScope(board:FlowBoard,groupId:string){
 const nodes=groupId?board.nodes.filter(n=>n.groupId===groupId):board.nodes,ids=new Set(nodes.map(n=>n.id));
 return {nodes,edges:board.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),external:board.edges.filter(e=>ids.has(e.source)!==ids.has(e.target))};
}
export const hasCardImage=(n:FlowNode)=>/!\[[^\]]*\]\([^)]+\)/.test(n.note);
/** Lay out contribution branches from their actual connections, keeping every card's dimensions. */
export function workbenchLayout(board:FlowBoard){
 const groups=new Map<string,FlowNode[]>();for(const n of board.nodes){const id=n.groupId??'';groups.set(id,[...(groups.get(id)??[]),n]);}
 const packed=[...groups.values()].map(nodes=>{
  const spine=nodes.filter(n=>!hasCardImage(n)&&!['evidence','conclusion'].includes(n.kind));
  const ids=new Set(spine.map(n=>n.id)),links=board.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),unvisited=new Set(ids),columns=new Map<number,FlowNode[]>();let base=0;
  for(const root of spine){if(!unvisited.has(root.id))continue;const component=new Set<string>(),queue=[root.id];while(queue.length){const id=queue.shift()!;if(component.has(id))continue;component.add(id);unvisited.delete(id);for(const e of links){if(e.source===id&&!component.has(e.target))queue.push(e.target);if(e.target===id&&!component.has(e.source))queue.push(e.source);}}
   const incoming=new Map([...component].map(id=>[id,links.filter(e=>e.target===id).length])),rank=new Map([...component].map(id=>[id,0]));const ready=[...component].filter(id=>!incoming.get(id));while(ready.length){const id=ready.shift()!;for(const e of links.filter(e=>e.source===id)){rank.set(e.target,Math.max(rank.get(e.target)!,rank.get(id)!+1));incoming.set(e.target,incoming.get(e.target)!-1);if(!incoming.get(e.target))ready.push(e.target);}}
   for(const n of spine.filter(n=>component.has(n.id))){const c=base+rank.get(n.id)!;columns.set(c,[...(columns.get(c)??[]),n]);}base+=Math.max(...rank.values())+1;
  }
  if(!columns.size)columns.set(0,[]);
  const ranks=[...columns.keys()].sort((a,b)=>a-b),xs=new Map<number,number>();let x=0;
  for(const c of ranks){xs.set(c,x);x+=Math.max(360,...columns.get(c)!.map(n=>flowNodeSize(n).width))+170;let y=100;for(const n of columns.get(c)!){n.x=xs.get(c)!;n.y=y;y+=flowNodeSize(n).height+140;}}
  // Center common prerequisites between their outgoing branches, rather than making a single reading chain.
  for(const c of [...ranks].reverse()){let bottom=100;for(const n of columns.get(c)!){const children=links.filter(e=>e.source===n.id).map(e=>spine.find(n=>n.id===e.target)!).filter(child=>child.x>n.x);if(children.length)n.y=Math.max(bottom,children.reduce((sum,child)=>sum+child.y+flowNodeSize(child).height/2,0)/children.length-flowNodeSize(n).height/2);bottom=n.y+flowNodeSize(n).height+140;}}
  const rankById=new Map([...columns].flatMap(([c,items])=>items.map(n=>[n.id,c] as const)));
  const floors=new Map(ranks.map(c=>[c,Math.max(100,...columns.get(c)!.map(n=>n.y+flowNodeSize(n).height))+140]));
  const supporting=nodes.filter(n=>!spine.includes(n)&&!hasCardImage(n));
  const placed=[...spine];for(const n of supporting){const neighbours=board.edges.filter(e=>e.source===n.id||e.target===n.id).map(e=>rankById.get(e.source===n.id?e.target:e.source)).filter((v):v is number=>v!==undefined);const target=neighbours.length?neighbours.reduce((sum,c)=>sum+xs.get(c)!,0)/neighbours.length:0;const candidates=ranks.map(c=>{const position=freeFlowPosition({version:1,nodes:placed,edges:[]},{x:xs.get(c)!,y:floors.get(c)!},n.id,flowNodeSize(n));return{c,position,cost:position.y+Math.abs(position.x-target)*.3};}).sort((a,b)=>a.cost-b.cost);const best=candidates[0];Object.assign(n,best.position);floors.set(best.c,n.y+flowNodeSize(n).height+140);placed.push(n);}
  const images=nodes.filter(hasCardImage);let imageX=Math.max(0,...nodes.filter(n=>!hasCardImage(n)).map(n=>n.x+flowNodeSize(n).width))+170;const imageY=100;
  for(const n of images){n.x=imageX;n.y=imageY;imageX+=flowNodeSize(n).width+170;}
  return{nodes,width:Math.max(...nodes.map(n=>n.x+flowNodeSize(n).width)),height:Math.max(...nodes.map(n=>n.y+flowNodeSize(n).height))};
 });
 let top=80;for(let i=0;i<packed.length;i+=2){const row=packed.slice(i,i+2);let left=48;for(const group of row){for(const n of group.nodes){n.x+=left;n.y+=top;}left+=group.width+400;}top+=Math.max(...row.map(g=>g.height))+340;}return board;
}
/** Keep the actively resized card anchored, and move collisions, using measured DOM heights. */
export function resizeWorkbenchCard(board:FlowBoard,id:string,width:number,height:number,imageHeight?:number){
 const node=board.nodes.find(n=>n.id===id);if(!node)return;
 node.width=Math.max(220,Math.min(1400,Math.round(width)));node.height=Math.max(152,Math.min(4000,Math.ceil(height)));node.autoHeight=true;
 if(imageHeight!==undefined){node.imageHeight=Math.max(120,Math.min(1600,Math.round(imageHeight)));node.height=Math.max(node.height,node.imageHeight+170);}
 const settled:FlowBoard={version:1,nodes:[node],edges:[]};
 for(const other of board.nodes.filter(n=>n!==node).sort((a,b)=>a.y-b.y||a.x-b.x)){
  Object.assign(other,freeFlowPosition(settled,other,other.id,flowNodeSize(other)));settled.nodes.push(other);
 }
}
