export type MenuRect={left:number;top:number;right:number;bottom:number};
export type MenuPlacement='bottom'|'top'|'right'|'left';
export function anchoredMenuPosition(anchor:MenuRect,bounds:MenuRect,size:{width:number;height:number}){
 const margin=8,gap=6,left=bounds.left+margin,top=bounds.top+margin,right=bounds.right-margin,bottom=bounds.bottom-margin;
 if(![anchor.left,anchor.top,anchor.right,anchor.bottom,bounds.left,bounds.top,bounds.right,bounds.bottom,size.width,size.height].every(Number.isFinite)||anchor.right<=bounds.left||anchor.left>=bounds.right||anchor.bottom<=bounds.top||anchor.top>=bounds.bottom||anchor.right<=anchor.left||anchor.bottom<=anchor.top||right<=left||bottom<=top||size.width<=0||size.height<=0)return;
 const width=Math.min(size.width,right-left),height=size.height,clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,max));
 const candidates=[
  {placement:'bottom' as const,capacity:bottom-anchor.bottom-gap,allowed:true},
  {placement:'top' as const,capacity:anchor.top-gap-top,allowed:true},
  {placement:'right' as const,capacity:bottom-top,allowed:right-anchor.right-gap>=width},
  {placement:'left' as const,capacity:bottom-top,allowed:anchor.left-gap-left>=width},
 ];
 const available=candidates.filter(c=>c.allowed&&c.capacity>0),chosen=available.find(c=>c.capacity>=height)??available.sort((a,b)=>b.capacity-a.capacity)[0];if(!chosen)return;
 const displayedHeight=Math.min(height,chosen.capacity),x=chosen.placement==='right'?anchor.right+gap:chosen.placement==='left'?anchor.left-gap-width:clamp(anchor.left,left,right-width);
 const y=chosen.placement==='bottom'?anchor.bottom+gap:chosen.placement==='top'?anchor.top-gap-displayedHeight:clamp((anchor.top+anchor.bottom-displayedHeight)/2,top,bottom-displayedHeight);
 return {placement:chosen.placement,left:x,top:y,width,maxHeight:chosen.capacity};
}
