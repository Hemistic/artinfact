import {canvasControlHeight} from './canvas-control-size.js';
export type RegionBox={x:number;y:number;width:number;height:number};
export type RegionDropTarget={id:string;title:string;color:string;bounds:RegionBox};
export const regionTitleHeight=canvasControlHeight;
export function regionDropTarget(card:RegionBox,regions:RegionDropTarget[],currentGroup?:string){
 const overlapping=regions.flatMap(region=>{const b=region.bounds,width=Math.min(card.x+card.width,b.x+b.width)-Math.max(card.x,b.x),height=Math.min(card.y+card.height,b.y+b.height)-Math.max(card.y,b.y);return width>=Math.min(20,card.width*.1)&&height>=Math.min(20,card.height*.1)?[{region,overlap:width*height}]:[];});
 const own=regions.find(r=>r.id===currentGroup);
 if(own&&overlapping.some(r=>r.region.id===own.id))return own;
 // Membership survives moves beyond the old bounds. Only an explicit removal detaches a card.
 return overlapping.sort((a,b)=>b.overlap-a.overlap||a.region.bounds.width*a.region.bounds.height-b.region.bounds.width*b.region.bounds.height)[0]?.region??own;
}
export function encloseRegionCards(cards:RegionBox[]):RegionBox|undefined{
 if(!cards.length)return;
 const x=Math.min(...cards.map(n=>n.x))-32,y=Math.min(...cards.map(n=>n.y))-regionTitleHeight-16;
 return{x,y,width:Math.max(...cards.map(n=>n.x+n.width))-x+32,height:Math.max(...cards.map(n=>n.y+n.height))-y+32};
}
