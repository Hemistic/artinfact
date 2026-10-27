export type PortSide='left'|'right'|'top'|'bottom';
export function horizontalPortSides(a:{x:number},b:{x:number},edge:{sourceSide?:PortSide;targetSide?:PortSide}){
 const forward=b.x>=a.x;
 return {sourceSide:edge.sourceSide==='left'||edge.sourceSide==='right'?edge.sourceSide:forward?'right' as const:'left' as const,targetSide:edge.targetSide==='left'||edge.targetSide==='right'?edge.targetSide:forward?'left' as const:'right' as const};
}
type Box={x:number;y:number;width:number;height:number};
const normals={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
export function portPoint(box:Box,side:PortSide){return{x:box.x+box.width*(side==='left'?0:side==='right'?1:.5),y:box.y+box.height*(side==='top'?0:side==='bottom'?1:.5)};}
export function connectionCurve(a:Box,b:Box,sourceSide:PortSide,targetSide:PortSide){
 return connectionGeometry(a,b,sourceSide,targetSide).path;
}
export function connectionGeometry(a:Box,b:Box,sourceSide:PortSide,targetSide:PortSide){
 const source=portPoint(a,sourceSide),target=portPoint(b,targetSide),n=normals[sourceSide],m=normals[targetSide],bend=Math.max(40,Math.min(240,Math.hypot(target.x-source.x,target.y-source.y)*.4));
 const c1={x:source.x+n.x*bend,y:source.y+n.y*bend},c2={x:target.x+m.x*bend,y:target.y+m.y*bend};
 return {path:`M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,center:{x:(source.x+3*c1.x+3*c2.x+target.x)/8,y:(source.y+3*c1.y+3*c2.y+target.y)/8}};
}
export function connectionIntent(board:{nodes:{id:string}[];edges:{source:string;target:string}[]},source:string,target:string|undefined,sourceSide:PortSide,targetSide:PortSide='left'){
 if(!target||target===source||![source,target].every(id=>board.nodes.some(n=>n.id===id))||board.edges.some(e=>e.source===source&&e.target===target))return;
 const queue=[target],seen=new Set<string>();while(queue.length){const id=queue.pop()!;if(id===source)return;if(seen.has(id))continue;seen.add(id);queue.push(...board.edges.filter(e=>e.source===id&&(!('kind' in e)||e.kind!=='context')).map(e=>e.target));}
 return {source,target,label:'关联',sourceSide,targetSide};
}
